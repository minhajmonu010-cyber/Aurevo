from decimal import Decimal
import hashlib
import hmac
from unittest.mock import patch

from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from account.models import Address, User
from adminpanel.models import Coupon, Offer
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

	def create_pending_multi_item_order(self):
		second_variant = ProductVariant.objects.create(
			product=self.variant.product,
			size="L",
			color="Black",
			sku="CHECKOUT-SHIRT-L-BLACK",
			price=Decimal("800.00"),
			stock=2,
		)
		self.variant.stock = 4
		self.variant.save(update_fields=["stock"])
		order = Order.objects.create(
			user=self.user,
			total_amount=Decimal("2000.00"),
			order_status=Order.PENDING,
			payment_method="cash_on_delivery",
		)
		first_item = OrderItem.objects.create(
			order=order,
			variant=self.variant,
			product_name="Checkout shirt",
			sku=self.variant.sku,
			size=self.variant.size,
			color=self.variant.color,
			quantity=1,
			price=Decimal("1200.00"),
			total_price=Decimal("1200.00"),
		)
		second_item = OrderItem.objects.create(
			order=order,
			variant=second_variant,
			product_name="Checkout shirt",
			sku=second_variant.sku,
			size=second_variant.size,
			color=second_variant.color,
			quantity=1,
			price=Decimal("800.00"),
			total_price=Decimal("800.00"),
		)
		Payment.objects.create(
			order=order,
			payment_method="cash_on_delivery",
			amount=order.total_amount,
			payment_status=Payment.PENDING,
		)
		return order, first_item, second_item, second_variant

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

	def test_checkout_query_count_does_not_grow_with_line_items(self):
		variants = [self.variant]
		for index, size in enumerate(("L", "XL"), start=1):
			variants.append(ProductVariant.objects.create(
				product=self.variant.product,
				size=size,
				color="Black",
				sku=f"CHECKOUT-SHIRT-{size}-BLACK",
				price=Decimal("1200.00"),
				stock=5,
			))

		with CaptureQueriesContext(connection) as one_item_queries:
			one_item_response = self.checkout({
				"address_id": self.address.id,
				"items": [{"variant_id": variants[0].id, "quantity": 1}],
			})
		with CaptureQueriesContext(connection) as three_item_queries:
			three_item_response = self.checkout({
				"address_id": self.address.id,
				"items": [
					{"variant_id": variant.id, "quantity": 1}
					for variant in variants
				],
			})

		self.assertEqual(one_item_response.status_code, 201, one_item_response.data)
		self.assertEqual(three_item_response.status_code, 201, three_item_response.data)
		self.assertEqual(len(one_item_queries), len(three_item_queries))
		self.assertEqual(len(three_item_response.data["items"]), 3)

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
		self.assertTrue(response.data["items"][0]["image"].startswith("http"))

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

	def test_best_product_and_category_offers_apply_before_coupon(self):
		now = timezone.now()
		Offer.objects.create(
			name="Product special",
			discount_type=Offer.PERCENTAGE,
			discount_value=Decimal("20.00"),
			applies_to=Offer.PRODUCTS,
			target_ids=[self.variant.product_id],
			start_date=now - timedelta(days=1),
			end_date=now + timedelta(days=1),
			is_active=True,
		)
		Offer.objects.create(
			name="Category special",
			discount_type=Offer.PERCENTAGE,
			discount_value=Decimal("15.00"),
			applies_to=Offer.CATEGORIES,
			target_ids=[self.variant.product.category_id],
			start_date=now - timedelta(days=1),
			end_date=now + timedelta(days=1),
			is_active=True,
		)
		other_category = Category.objects.create(name="Other offer category")
		other_product = Product.objects.create(name="Other offer shirt", category=other_category)
		other_variant = ProductVariant.objects.create(
			product=other_product,
			size="M",
			color="Blue",
			sku="OTHER-OFFER-SHIRT-M-BLUE",
			price=Decimal("800.00"),
			stock=3,
		)
		Offer.objects.create(
			name="Category special",
			discount_type=Offer.PERCENTAGE,
			discount_value=Decimal("10.00"),
			applies_to=Offer.CATEGORIES,
			target_ids=[other_category.id],
			start_date=now - timedelta(days=1),
			end_date=now + timedelta(days=1),
			is_active=True,
		)
		coupon = self.create_coupon()

		response = self.checkout({
			"address_id": self.address.id,
			"coupon_code": coupon.code,
			"items": [
				{"variant_id": self.variant.id, "quantity": 1},
				{"variant_id": other_variant.id, "quantity": 1},
			],
		})

		self.assertEqual(response.status_code, 201, response.data)
		self.assertEqual(response.data["total_amount"], "1512.00")
		self.assertEqual(response.data["discount_amount"], "788.00")
		self.assertEqual(
			[Decimal(item["total_price"]) for item in response.data["items"]],
			[Decimal("960.00"), Decimal("720.00")],
		)
		order_items = list(OrderItem.objects.order_by("id"))
		self.assertEqual(
			[item.price for item in order_items],
			[Decimal("960.00"), Decimal("720.00")],
		)

	def test_customer_can_cancel_order_items_individually(self):
		order, first_item, second_item, second_variant = self.create_pending_multi_item_order()

		response = self.client.post(
			f"/api/orders/{order.pk}/items/{first_item.pk}/cancel/"
		)

		self.assertEqual(response.status_code, 200, response.data)
		self.assertEqual(response.data["order"]["total_amount"], "800.00")
		self.assertTrue(response.data["order"]["items"][0]["is_cancelled"])
		self.assertFalse(response.data["order"]["items"][0]["can_cancel"])
		self.assertTrue(response.data["order"]["items"][1]["can_cancel"])
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 5)
		payment = Payment.objects.get(order=order)
		self.assertEqual(payment.amount, Decimal("800.00"))

		last_response = self.client.post(
			f"/api/orders/{order.pk}/items/{second_item.pk}/cancel/"
		)

		self.assertEqual(last_response.status_code, 200, last_response.data)
		self.assertEqual(last_response.data["order"]["order_status"], Order.CANCELLED)
		second_variant.refresh_from_db()
		self.assertEqual(second_variant.stock, 3)
		payment.refresh_from_db()
		self.assertEqual(payment.payment_status, Payment.FAILED)

	def test_partial_item_cancellation_releases_coupon_below_minimum_order(self):
		order, item, _, _ = self.create_pending_multi_item_order()
		coupon = self.create_coupon(minimum_order_amount=Decimal("1000.00"))
		coupon.used_count = 1
		coupon.save(update_fields=["used_count"])
		order.coupon = coupon
		order.coupon_code = coupon.code
		order.coupon_discount_amount = Decimal("200.00")
		order.discount_amount = Decimal("200.00")
		order.total_amount = Decimal("1800.00")
		order.save(update_fields=[
			"coupon",
			"coupon_code",
			"coupon_discount_amount",
			"discount_amount",
			"total_amount",
		])

		response = self.client.post(
			f"/api/orders/{order.pk}/items/{item.pk}/cancel/"
		)

		self.assertEqual(response.status_code, 200, response.data)
		order.refresh_from_db()
		coupon.refresh_from_db()
		self.assertIsNone(order.coupon_id)
		self.assertEqual(order.coupon_code, "")
		self.assertEqual(order.coupon_discount_amount, Decimal("0.00"))
		self.assertEqual(order.discount_amount, Decimal("0.00"))
		self.assertEqual(order.total_amount, Decimal("800.00"))
		self.assertEqual(coupon.used_count, 0)

	def test_paid_wallet_order_items_refund_wallet_individually(self):
		order, item, second_item, _ = self.create_pending_multi_item_order()
		order.order_status = Order.PROCESSING
		order.save(update_fields=["order_status"])
		Payment.objects.filter(order=order).update(
			payment_status=Payment.PAID,
			payment_method="wallet",
		)
		wallet = Wallet.objects.create(user=self.user, balance=Decimal("0.00"))

		response = self.client.post(
			f"/api/orders/{order.pk}/items/{item.pk}/cancel/"
		)

		self.assertEqual(response.status_code, 200, response.data)
		self.assertEqual(response.data["refund"]["amount"], "1200.00")
		self.assertEqual(response.data["refund"]["method"], "wallet")
		wallet.refresh_from_db()
		self.assertEqual(wallet.balance, Decimal("1200.00"))
		item.refresh_from_db()
		self.assertTrue(item.is_cancelled)
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 5)

		last_response = self.client.post(
			f"/api/orders/{order.pk}/items/{second_item.pk}/cancel/"
		)

		self.assertEqual(last_response.status_code, 200, last_response.data)
		self.assertEqual(last_response.data["order"]["order_status"], Order.CANCELLED)
		wallet.refresh_from_db()
		self.assertEqual(wallet.balance, Decimal("2000.00"))
		payment = Payment.objects.get(order=order)
		self.assertEqual(payment.payment_status, Payment.REFUNDED)
		self.assertEqual(payment.refunded_amount, Decimal("2000.00"))

	def test_processing_wallet_order_full_cancellation_refunds_wallet(self):
		order, _, _, second_variant = self.create_pending_multi_item_order()
		order.order_status = Order.PROCESSING
		order.save(update_fields=["order_status"])
		Payment.objects.filter(order=order).update(
			payment_status=Payment.PAID,
			payment_method="wallet",
		)
		wallet = Wallet.objects.create(user=self.user, balance=Decimal("0.00"))

		response = self.client.post(f"/api/orders/{order.pk}/cancel/")

		self.assertEqual(response.status_code, 200, response.data)
		self.assertEqual(response.data["refund"]["amount"], "2000.00")
		wallet.refresh_from_db()
		self.assertEqual(wallet.balance, Decimal("2000.00"))
		payment = Payment.objects.get(order=order)
		self.assertEqual(payment.payment_status, Payment.REFUNDED)
		self.assertEqual(payment.refunded_amount, Decimal("2000.00"))
		self.variant.refresh_from_db()
		second_variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 5)
		self.assertEqual(second_variant.stock, 3)

	@override_settings(RAZORPAY_KEY_ID="rzp_test_key", RAZORPAY_KEY_SECRET="test_secret")
	def test_paid_razorpay_item_cancellation_requests_partial_refund(self):
		order, item, _, _ = self.create_pending_multi_item_order()
		order.order_status = Order.PROCESSING
		order.save(update_fields=["order_status"])
		Payment.objects.filter(order=order).update(
			payment_status=Payment.PAID,
			payment_method="razorpay",
			transaction_id="pay_item_refund",
		)
		refund_response = patch("orders.views.requests.post")
		mock_request = refund_response.start()
		mock_request.return_value.json.return_value = {
			"id": "rfnd_item_1",
			"status": "processed",
		}
		try:
			response = self.client.post(
				f"/api/orders/{order.pk}/items/{item.pk}/cancel/"
			)
		finally:
			refund_response.stop()

		self.assertEqual(response.status_code, 200, response.data)
		self.assertEqual(response.data["refund"]["amount"], "1200.00")
		self.assertEqual(response.data["refund"]["method"], "razorpay")
		self.assertEqual(response.data["order"]["payments"][0]["refund_id"], "rfnd_item_1")
		request_body = mock_request.call_args.kwargs["json"]
		self.assertEqual(request_body["amount"], 120000)
		payment = Payment.objects.get(order=order)
		self.assertEqual(payment.refunded_amount, Decimal("1200.00"))
		self.assertEqual(payment.payment_status, Payment.PAID)

	def test_online_payment_pending_order_item_cannot_be_cancelled(self):
		order, item, _, _ = self.create_pending_multi_item_order()
		Payment.objects.filter(order=order).update(
			payment_method="razorpay",
			gateway_order_id="gateway-order",
		)

		response = self.client.post(
			f"/api/orders/{order.pk}/items/{item.pk}/cancel/"
		)

		self.assertEqual(response.status_code, 409)
		item.refresh_from_db()
		self.assertFalse(item.is_cancelled)

	def test_whole_order_cancellation_does_not_restore_item_stock_twice(self):
		order, first_item, _, _ = self.create_pending_multi_item_order()
		partial = self.client.post(
			f"/api/orders/{order.pk}/items/{first_item.pk}/cancel/"
		)
		self.assertEqual(partial.status_code, 200, partial.data)

		response = self.client.post(f"/api/orders/{order.pk}/cancel/")

		self.assertEqual(response.status_code, 200, response.data)
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 5)

	def test_processing_unpaid_order_can_be_cancelled(self):
		order, _, _, second_variant = self.create_pending_multi_item_order()
		order.order_status = Order.PROCESSING
		order.save(update_fields=["order_status"])

		response = self.client.post(f"/api/orders/{order.pk}/cancel/")

		self.assertEqual(response.status_code, 200, response.data)
		order.refresh_from_db()
		self.assertEqual(order.order_status, Order.CANCELLED)
		self.assertEqual(order.items.filter(is_cancelled=True).count(), 2)
		self.variant.refresh_from_db()
		second_variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 5)
		self.assertEqual(second_variant.stock, 3)
		self.assertEqual(
			Payment.objects.get(order=order).payment_status,
			Payment.FAILED,
		)

	def test_processing_paid_order_cannot_be_cancelled_online(self):
		order, _, _, _ = self.create_pending_multi_item_order()
		order.order_status = Order.PROCESSING
		order.save(update_fields=["order_status"])
		Payment.objects.filter(order=order).update(
			payment_status=Payment.PAID,
			payment_method="razorpay",
			transaction_id="pay_full_refund",
		)
		with patch("orders.views.requests.post") as mock_request:
			mock_request.return_value.json.return_value = {
				"id": "rfnd_full_1",
				"status": "processed",
			}
			response = self.client.post(f"/api/orders/{order.pk}/cancel/")

		self.assertEqual(response.status_code, 200, response.data)
		self.assertEqual(response.data["refund"]["amount"], "2000.00")
		self.assertEqual(mock_request.call_args.kwargs["json"]["amount"], 200000)
		order.refresh_from_db()
		self.assertEqual(order.order_status, Order.CANCELLED)
		payment = Payment.objects.get(order=order)
		self.assertEqual(payment.payment_status, Payment.REFUNDED)
		self.assertEqual(payment.refunded_amount, Decimal("2000.00"))
		self.variant.refresh_from_db()
		self.assertEqual(self.variant.stock, 5)

	@override_settings(RAZORPAY_KEY_ID="rzp_test_key", RAZORPAY_KEY_SECRET="test_secret")
	def test_processing_order_waits_for_pending_razorpay_refund_before_more_cancellations(self):
		order, item, second_item, _ = self.create_pending_multi_item_order()
		order.order_status = Order.PROCESSING
		order.save(update_fields=["order_status"])
		Payment.objects.filter(order=order).update(
			payment_status=Payment.PAID,
			payment_method="razorpay",
			transaction_id="pay_pending_refund",
		)
		with patch("orders.views.requests.post") as mock_request:
			mock_request.return_value.json.return_value = {
				"id": "rfnd_pending_1",
				"status": "pending",
			}
			response = self.client.post(
				f"/api/orders/{order.pk}/items/{item.pk}/cancel/"
			)

		self.assertEqual(response.status_code, 200, response.data)
		payment = Payment.objects.get(order=order)
		self.assertEqual(payment.payment_status, Payment.REFUND_PENDING)
		self.assertFalse(response.data["order"]["items"][1]["can_cancel"])

		second_response = self.client.post(
			f"/api/orders/{order.pk}/items/{second_item.pk}/cancel/"
		)
		self.assertEqual(second_response.status_code, 409)
		self.assertEqual(mock_request.call_count, 1)

	def test_percentage_coupon_maximum_discount_caps_checkout_and_preview(self):
		coupon = self.create_coupon(max_discount_amount=Decimal("50.00"))

		preview = self.client.get("/api/orders/checkout/coupons/?subtotal=1200.00")

		self.assertEqual(preview.status_code, 200)
		self.assertEqual(preview.data["results"][0]["max_discount_amount"], "50.00")
		self.assertEqual(preview.data["results"][0]["discount_amount"], "50.00")

		response = self.checkout({
			"address_id": self.address.id,
			"coupon_code": coupon.code,
			"items": [{"variant_id": self.variant.id, "quantity": 1}],
		})

		self.assertEqual(response.status_code, 201, response.data)
		self.assertEqual(response.data["discount_amount"], "350.00")
		self.assertEqual(response.data["total_amount"], "1150.00")

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
		self.item = OrderItem.objects.create(
			order=self.order,
			product_name="Return test product",
			sku="RETURN-TEST",
			quantity=1,
			price=Decimal("30.00"),
			total_price=Decimal("30.00"),
		)

	def test_customer_can_return_one_product_line_at_a_time(self):
		second_item = OrderItem.objects.create(
			order=self.order,
			product_name="Second return product",
			sku="RETURN-SECOND",
			quantity=1,
			price=Decimal("10.00"),
			total_price=Decimal("10.00"),
		)
		Order.objects.filter(pk=self.order.pk).update(
			total_amount=Decimal("36.00"),
			discount_amount=Decimal("4.00"),
			coupon_discount_amount=Decimal("4.00"),
		)

		response = self.client.post(
			f"/api/orders/{self.order.pk}/items/{self.item.pk}/return/",
			{"reason": "The item does not fit."},
			format="json",
		)

		self.assertEqual(response.status_code, 201, response.data)
		self.assertEqual(response.data["refund_amount"], Decimal("27.00"))
		self.order.refresh_from_db()
		self.assertEqual(self.order.order_status, Order.DELIVERED)
		return_request = OrderReturn.objects.get(order=self.order, item=self.item)
		self.assertEqual(return_request.reason, "The item does not fit.")
		self.assertEqual(return_request.refund_amount, Decimal("27.00"))
		order_response = self.client.get("/api/orders/")
		orders_data = (
			order_response.data
			if isinstance(order_response.data, list)
			else order_response.data["results"]
		)
		response_item = next(
			item
			for order_data in orders_data
			for item in order_data["items"]
			if item["id"] == self.item.pk
		)
		self.assertFalse(response_item["can_return"])
		self.assertEqual(response_item["return_status"], OrderReturn.REQUESTED)

		duplicate = self.client.post(
			f"/api/orders/{self.order.pk}/items/{self.item.pk}/return/",
			{"reason": "Trying again."},
			format="json",
		)
		self.assertEqual(duplicate.status_code, 409)

		second_response = self.client.post(
			f"/api/orders/{self.order.pk}/items/{second_item.pk}/return/",
			{"reason": "Different product."},
			format="json",
		)
		self.assertEqual(second_response.status_code, 201, second_response.data)
		self.assertEqual(second_response.data["refund_amount"], Decimal("9.00"))
		self.assertEqual(OrderReturn.objects.filter(order=self.order).count(), 2)

	def test_customer_must_provide_a_return_reason(self):
		response = self.client.post(
			f"/api/orders/{self.order.pk}/items/{self.item.pk}/return/",
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

		response = self.client.post(
			f"/api/orders/{self.order.pk}/items/{self.item.pk}/return/",
			{"reason": "Changed my mind."},
			format="json",
		)

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

		response = self.client.post(
			f"/api/orders/{other_order.pk}/items/{self.item.pk}/return/",
			{"reason": "Not mine."},
			format="json",
		)

		self.assertEqual(response.status_code, 404)
