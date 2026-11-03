from decimal import Decimal
import hashlib
import hmac
from unittest.mock import patch

from django.test import override_settings
from rest_framework.test import APITestCase

from account.models import Address, User
from adminpanel.models import Coupon
from catalog.models import Category, InventoryLog, Product, ProductImage, ProductVariant, Review
from storefront.models import CartItem
from wallet.models import Wallet, WalletTransaction
from django.utils import timezone
from datetime import timedelta

from .models import Order, OrderItem, OrderReturn, OrderStatusHistory, Payment


class CheckoutTests(APITestCase):
	def setUp(self):
		self.user = User.objects.create_user(
			email="checkout@example.com",
			password="Checkout-Pass-2026",
			first_name="Checkout",
			is_verified=True,
		)
		self.client.force_authenticate(user=self.user)
		category = Category.objects.create(name="Checkout category")
		product = Product.objects.create(name="Checkout shirt", category=category)
		self.variant = ProductVariant.objects.create(
			product=product,
			size="M",
			color="Black",
			sku="CHECKOUT-SHIRT-M-BLACK",
			price=Decimal("1200.00"),
			original_price=Decimal("1500.00"),
			stock=5,
		)
		self.address = Address.objects.create(
			user=self.user,
			full_name="Checkout Customer",
			phone="+919876543210",
			address_line1="12 Main Road",
			city="Kochi",
			district="Ernakulam",
			state="Kerala",
			postal_code="682001",
			country="India",
		)

	def checkout(self, payload):
		return self.client.post("/api/orders/checkout/", payload, format="json")

	def test_checkout_rejects_malformed_and_duplicate_items(self):
		payloads = [
			{"address_id": True},
			{"address_id": self.address.id, "items": [{"variant_id": self.variant.id, "quantity": True}]},
			{"address_id": self.address.id, "items": [
				{"variant_id": self.variant.id, "quantity": 1},
				{"variant_id": self.variant.id, "quantity": 1},
			]},
		]

		for payload in payloads:
			with self.subTest(payload=payload):
				response = self.checkout(payload)
				self.assertEqual(response.status_code, 400, response.data)

		self.assertEqual(Order.objects.count(), 0)
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 5)

	def create_coupon(self, code="SAVE10", **overrides):
		now = timezone.now()
		return Coupon.objects.create(
			code=code,
			discount_type=Coupon.PERCENTAGE,
			discount_value=Decimal("10"),
			start_date=now - timedelta(days=1),
			end_date=now + timedelta(days=1),
			**overrides,
		)

	def test_buy_now_creates_cod_order_and_preserves_existing_cart(self):
		CartItem.objects.create(user=self.user, variant=self.variant, quantity=1)

		response = self.checkout({
			"address_id": self.address.id,
			"items": [{"variant_id": self.variant.id, "quantity": 2}],
		})

		self.assertEqual(response.status_code, 201, response.data)
		self.assertEqual(response.data["payment_method"], "cash_on_delivery")
		self.assertEqual(response.data["shipping_address"]["district"], "Ernakulam")
		self.assertEqual(response.data["items"][0]["quantity"], 2)
		self.assertEqual(response.data["total_amount"], "2400.00")
		self.assertEqual(Order.objects.count(), 1)
		self.assertEqual(OrderItem.objects.count(), 1)
		self.assertEqual(Payment.objects.get().payment_status, Payment.PENDING)
		self.assertEqual(InventoryLog.objects.get().quantity, 2)
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 3)
		self.assertEqual(CartItem.objects.filter(user=self.user).count(), 1)

	def test_checkout_rejects_an_out_of_stock_variant(self):
		self.variant.stock = 0
		self.variant.save(update_fields=["stock"])

		response = self.checkout({
			"address_id": self.address.id,
			"items": [{"variant_id": self.variant.id, "quantity": 1}],
		})

		self.assertEqual(response.status_code, 400)
		self.assertIn("Only 0", response.data["detail"])
		self.assertEqual(Order.objects.count(), 0)
		self.assertFalse(InventoryLog.objects.exists())

	def test_cart_checkout_places_all_items_and_clears_cart(self):
		CartItem.objects.create(user=self.user, variant=self.variant, quantity=3)

		response = self.checkout({"address_id": self.address.id})

		self.assertEqual(response.status_code, 201, response.data)
		self.assertEqual(response.data["items"][0]["quantity"], 3)
		self.assertEqual(CartItem.objects.filter(user=self.user).count(), 0)
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 2)

	def test_order_items_include_a_snapshot_of_the_product_image(self):
		ProductImage.objects.create(
			product=self.variant.product,
			image="products/checkout-shirt.jpg",
			is_primary=True,
		)
		CartItem.objects.create(user=self.user, variant=self.variant, quantity=1)

		response = self.checkout({"address_id": self.address.id})

		self.assertEqual(response.status_code, 201, response.data)
		self.assertTrue(response.data["items"][0]["image"].endswith("/media/products/checkout-shirt.jpg"))

	def test_wallet_checkout_debits_balance_and_pays_order(self):
		wallet = Wallet.objects.create(user=self.user, balance=Decimal("2500.00"))
		CartItem.objects.create(user=self.user, variant=self.variant, quantity=2)

		response = self.checkout({"address_id": self.address.id, "payment_method": "wallet"})

		self.assertEqual(response.status_code, 201, response.data)
		self.assertEqual(response.data["payment_method"], "wallet")
		self.assertEqual(response.data["order_status"], Order.PROCESSING)
		self.assertEqual(response.data["payments"][0]["payment_status"], Payment.PAID)
		wallet.refresh_from_db()
		self.assertEqual(wallet.balance, Decimal("100.00"))
		transaction = WalletTransaction.objects.get(wallet=wallet)
		self.assertEqual(transaction.transaction_type, WalletTransaction.DEBIT)
		self.assertEqual(transaction.amount, Decimal("2400.00"))
		self.assertEqual(CartItem.objects.filter(user=self.user).count(), 0)
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 3)

	def test_wallet_checkout_rejects_insufficient_balance_without_ordering(self):
		wallet = Wallet.objects.create(user=self.user, balance=Decimal("100.00"))
		CartItem.objects.create(user=self.user, variant=self.variant, quantity=1)

		response = self.checkout({"address_id": self.address.id, "payment_method": "wallet"})

		self.assertEqual(response.status_code, 400)
		self.assertIn("wallet balance", response.data["detail"])
		self.assertEqual(Order.objects.count(), 0)
		self.assertEqual(WalletTransaction.objects.count(), 0)
		self.assertEqual(CartItem.objects.filter(user=self.user).count(), 1)
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 5)

	def test_valid_coupon_reduces_order_total(self):
		coupon = self.create_coupon()
		response = self.checkout({
			"address_id": self.address.id,
			"coupon_code": "SAVE10",
			"items": [{"variant_id": self.variant.id, "quantity": 1}],
		})

		self.assertEqual(response.status_code, 201, response.data)
		self.assertEqual(response.data["discount_amount"], "420.00")
		self.assertEqual(response.data["total_amount"], "1080.00")
		self.assertEqual(Order.objects.get().discount_amount, Decimal("420.00"))
		self.assertEqual(Order.objects.get().coupon_code, "SAVE10")
		coupon.refresh_from_db()
		self.assertEqual(coupon.used_count, 1)

	def test_invalid_coupon_is_rejected(self):
		response = self.checkout({
			"address_id": self.address.id,
			"coupon_code": "INVALID",
			"items": [{"variant_id": self.variant.id, "quantity": 1}],
		})

		self.assertEqual(response.status_code, 400, response.data)
		self.assertIn("coupon_code", response.data)
		self.assertEqual(Order.objects.count(), 0)

	def test_available_admin_coupons_are_returned_with_order_savings(self):
		self.create_coupon(code="SAVE10", minimum_order_amount=Decimal("500"))
		response = self.client.get("/api/orders/checkout/coupons/?subtotal=1200.00")

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data["results"][0]["code"], "SAVE10")
		self.assertTrue(response.data["results"][0]["eligible"])
		self.assertEqual(response.data["results"][0]["discount_amount"], "120.00")

	def test_cancelled_coupon_order_releases_the_usage_reservation(self):
		self.variant.stock = 4
		self.variant.save(update_fields=["stock"])
		coupon = self.create_coupon()
		CartItem.objects.create(user=self.user, variant=self.variant, quantity=1)
		response = self.checkout({"address_id": self.address.id, "coupon_code": coupon.code})
		self.assertEqual(response.status_code, 201, response.data)

		cancelled = self.client.post(f"/api/orders/{response.data['id']}/cancel/")

		self.assertEqual(cancelled.status_code, 200, cancelled.data)
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 4)
		coupon.refresh_from_db()
		self.assertEqual(coupon.used_count, 0)

	@override_settings(RAZORPAY_KEY_ID="rzp_test_key", RAZORPAY_KEY_SECRET="test_secret")
	def test_razorpay_payment_is_verified_before_order_is_marked_paid(self):
		provider_order = {
			"id": "order_test_123",
			"amount": 240000,
			"currency": "INR",
		}
		with patch("orders.views.create_razorpay_order", return_value=provider_order):
			response = self.checkout({
				"address_id": self.address.id,
				"payment_method": "razorpay",
				"items": [{"variant_id": self.variant.id, "quantity": 2}],
			})

		self.assertEqual(response.status_code, 201, response.data)
		self.assertTrue(response.data["payment_required"])
		self.assertEqual(response.data["razorpay"]["order_id"], provider_order["id"])
		self.assertEqual(Order.objects.get().payment_method, "razorpay")
		self.assertEqual(Payment.objects.get().payment_status, Payment.PENDING)
		self.assertEqual(Payment.objects.get().payment_method, "razorpay")
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 3)

		payment_id = "pay_test_123"
		signature = hmac.new(
			b"test_secret",
			f"{provider_order['id']}|{payment_id}".encode(),
			hashlib.sha256,
		).hexdigest()
		provider_payment = {
			"order_id": provider_order["id"],
			"amount": provider_order["amount"],
			"currency": "INR",
			"status": "captured",
		}
		with patch("orders.views.fetch_razorpay_payment", return_value=provider_payment):
			verified = self.client.post(
				"/api/orders/checkout/verify/",
				{
					"local_order_id": response.data["local_order_id"],
					"razorpay_order_id": provider_order["id"],
					"razorpay_payment_id": payment_id,
					"razorpay_signature": signature,
				},
				format="json",
			)

		self.assertEqual(verified.status_code, 200, verified.data)
		self.assertEqual(verified.data["order_status"], Order.PROCESSING)
		self.assertEqual(Payment.objects.get().payment_status, Payment.PAID)
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 3)

	@override_settings(RAZORPAY_KEY_ID="rzp_test_key", RAZORPAY_KEY_SECRET="test_secret")
	def test_cancelled_online_payment_releases_reserved_stock(self):
		with patch(
			"orders.views.create_razorpay_order",
			return_value={"id": "order_cancel_test", "amount": 120000, "currency": "INR"},
		):
			response = self.checkout({
				"address_id": self.address.id,
				"payment_method": "razorpay",
				"items": [{"variant_id": self.variant.id, "quantity": 1}],
			})

		self.assertEqual(response.status_code, 201, response.data)
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 4)

		cancelled = self.client.post(
			"/api/orders/checkout/cancel/",
			{"local_order_id": response.data["local_order_id"]},
			format="json",
		)

		self.assertEqual(cancelled.status_code, 200, cancelled.data)
		self.assertEqual(Payment.objects.get().payment_status, Payment.FAILED)
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 5)


class CustomerOrderReviewTests(APITestCase):
	def setUp(self):
		self.user = User.objects.create_user(
			email="review-order@example.com",
			password="Review-Order-Pass-2026",
			first_name="Review",
			is_verified=True,
		)
		self.client.force_authenticate(user=self.user)
		category = Category.objects.create(name="Review category")
		product = Product.objects.create(name="Review shirt", category=category)
		self.variant = ProductVariant.objects.create(
			product=product,
			size="M",
			color="Black",
			sku="REVIEW-SHIRT-M-BLACK",
			price=Decimal("100.00"),
		)
		self.order = Order.objects.create(
			user=self.user,
			total_amount=Decimal("100.00"),
			order_status=Order.DELIVERED,
		)
		self.item = OrderItem.objects.create(
			order=self.order,
			variant=self.variant,
			product_name=self.variant.product.name,
			quantity=1,
			price=Decimal("100.00"),
			total_price=Decimal("100.00"),
		)

	def review(self, order_id=None, item_id=None, payload=None):
		return self.client.post(
			f"/api/orders/{order_id or self.order.id}/items/{item_id or self.item.id}/review/",
			payload or {"rating": 5, "comment": "Great quality."},
			format="json",
		)

	def test_customer_can_review_a_delivered_order_item_once(self):
		response = self.review()

		self.assertEqual(response.status_code, 201, response.data)
		review = Review.objects.get(user=self.user, product=self.variant.product)
		self.assertEqual(review.rating, 5)
		self.assertFalse(review.is_approved)
		self.assertEqual(self.review().status_code, 409)
		orders = self.client.get("/api/orders/")
		self.assertEqual(orders.status_code, 200)
		self.assertEqual(orders.data[0]["items"][0]["product_id"], self.variant.product_id)
		self.assertTrue(orders.data[0]["items"][0]["reviewed"])

	def test_review_requires_ownership_and_delivery(self):
		self.order.order_status = Order.SHIPPED
		self.order.save(update_fields=["order_status"])
		self.assertEqual(self.review().status_code, 400)

		self.order.order_status = Order.DELIVERED
		self.order.save(update_fields=["order_status"])
		other_user = User.objects.create_user(
			email="other-reviewer@example.com",
			password="Other-Review-Pass-2026",
			first_name="Other",
			is_verified=True,
		)
		other_order = Order.objects.create(user=other_user, total_amount=Decimal("100.00"))
		self.assertEqual(self.review(order_id=other_order.id).status_code, 404)

	def test_review_rating_must_be_between_one_and_five(self):
		response = self.review(payload={"rating": 6, "comment": "Too high."})
		self.assertEqual(response.status_code, 400)
		self.assertEqual(Review.objects.count(), 0)


class CustomerOrderReturnTests(APITestCase):
	def setUp(self):
		self.user = User.objects.create_user(
			email="return@example.com",
			password="test-password",
			is_verified=True,
		)
		self.client.force_authenticate(user=self.user)
		self.order = Order.objects.create(
			user=self.user,
			total_amount=Decimal("30.00"),
			order_status=Order.DELIVERED,
		)

	def test_customer_can_return_delivered_order_and_history_is_recorded(self):
		response = self.client.post(
			f"/api/orders/{self.order.pk}/return/",
			{"reason": "The item does not fit."},
			format="json",
		)

		self.assertEqual(response.status_code, 200, response.data)
		self.order.refresh_from_db()
		self.assertEqual(self.order.order_status, Order.RETURNED)
		self.assertEqual(self.order.return_reason, "The item does not fit.")
		return_request = OrderReturn.objects.get(order=self.order)
		self.assertEqual(return_request.reason, "The item does not fit.")
		self.assertEqual(return_request.refund_amount, self.order.total_amount)
		self.assertTrue(
			OrderStatusHistory.objects.filter(
				order=self.order,
				status=Order.RETURNED,
			).exists()
		)

	def test_customer_must_provide_a_return_reason(self):
		response = self.client.post(
			f"/api/orders/{self.order.pk}/return/",
			{"reason": "  "},
			format="json",
		)

		self.assertEqual(response.status_code, 400)
		self.assertIn("reason", response.data)
		self.order.refresh_from_db()
		self.assertEqual(self.order.order_status, Order.DELIVERED)

	def test_customer_cannot_return_an_order_that_is_not_delivered(self):
		self.order.order_status = Order.SHIPPED
		self.order.save(update_fields=["order_status"])

		response = self.client.post(f"/api/orders/{self.order.pk}/return/")

		self.assertEqual(response.status_code, 400)
		self.order.refresh_from_db()
		self.assertEqual(self.order.order_status, Order.SHIPPED)

	def test_customer_cannot_return_another_customers_order(self):
		other_user = User.objects.create_user(
			email="other-return@example.com",
			password="test-password",
			is_verified=True,
		)
		other_order = Order.objects.create(
			user=other_user,
			total_amount=Decimal("30.00"),
			order_status=Order.DELIVERED,
		)

		response = self.client.post(f"/api/orders/{other_order.pk}/return/")

		self.assertEqual(response.status_code, 404)
