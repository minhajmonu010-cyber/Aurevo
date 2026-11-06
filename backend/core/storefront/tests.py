from django.test import TestCase
from decimal import Decimal

from rest_framework.test import APITestCase

from account.models import User
from adminpanel.models import Offer
from catalog.models import Category, Product, ProductVariant
from .models import CartItem, WishlistItem
from django.utils import timezone
from datetime import timedelta


class CartPricingTests(APITestCase):
	def test_cart_returns_original_and_discounted_totals(self):
		user = User.objects.create_user(email="shopper@example.com", password="test-pass")
		category = Category.objects.create(name="Clothing")
		product = Product.objects.create(name="Tee", category=category)
		variant = ProductVariant.objects.create(
			product=product,
			size="M",
			color="Black",
			sku="TEE-M-BLACK",
			price=Decimal("80.00"),
			original_price=Decimal("100.00"),
			stock=5,
		)
		CartItem.objects.create(user=user, variant=variant, quantity=2)
		self.client.force_authenticate(user)

		response = self.client.get("/api/shop/cart/")

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data["subtotal"], "160.00")
		self.assertEqual(response.data["original_subtotal"], "200.00")
		self.assertEqual(response.data["discount_total"], "40.00")
		self.assertEqual(response.data["items"][0]["original_line_total"], "200.00")

	def test_cart_applies_active_product_offer_to_displayed_price(self):
		user = User.objects.create_user(
			email="offer-shopper@example.com",
			password="test-password",
		)
		category = Category.objects.create(name="Offer clothing")
		product = Product.objects.create(name="Offer tee", category=category)
		variant = ProductVariant.objects.create(
			product=product,
			size="M",
			color="Black",
			sku="OFFER-TEE-M-BLACK",
			price=Decimal("80.00"),
			original_price=Decimal("100.00"),
			stock=5,
		)
		now = timezone.now()
		Offer.objects.create(
			name="Selected tee deal",
			discount_type=Offer.PERCENTAGE,
			discount_value=Decimal("20.00"),
			applies_to=Offer.PRODUCTS,
			target_ids=[product.id],
			start_date=now - timedelta(days=1),
			end_date=now + timedelta(days=1),
			is_active=True,
		)
		CartItem.objects.create(user=user, variant=variant, quantity=2)
		self.client.force_authenticate(user)

		response = self.client.get("/api/shop/cart/")

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data["subtotal"], "128.00")
		self.assertEqual(response.data["discount_total"], "72.00")
		self.assertEqual(response.data["items"][0]["price"], "64.00")
		self.assertEqual(response.data["items"][0]["offer_name"], "Selected tee deal")
		self.assertEqual(response.data["items"][0]["offer_line_discount"], "32.00")


class CartWriteValidationTests(APITestCase):
	def setUp(self):
		self.user = User.objects.create_user(email="cart-writes@example.com", password=None)
		self.client.force_authenticate(self.user)
		category = Category.objects.create(name="Cart validation")
		product = Product.objects.create(name="Cart validation product", category=category)
		self.variant = ProductVariant.objects.create(
			product=product,
			size="M",
			color="Black",
			sku="CART-VALIDATION-M",
			price=Decimal("10.00"),
			stock=3,
		)

	def test_cart_rejects_boolean_and_out_of_range_quantities(self):
		for quantity in (True, 0, 1_000_001):
			response = self.client.post(
				"/api/shop/cart/",
				{"variant_id": self.variant.pk, "quantity": quantity},
				format="json",
			)
			self.assertEqual(response.status_code, 400, response.data)
		self.assertFalse(CartItem.objects.exists())

	def test_cart_rejects_a_variant_with_zero_stock(self):
		self.variant.stock = 0
		self.variant.save(update_fields=["stock"])

		response = self.client.post(
			"/api/shop/cart/",
			{"variant_id": self.variant.pk, "quantity": 1},
			format="json",
		)

		self.assertEqual(response.status_code, 400)
		self.assertFalse(CartItem.objects.exists())


class WishlistQueryTests(APITestCase):
	def test_wishlist_variant_and_image_loading_uses_constant_queries(self):
		user = User.objects.create_user(
			email="wishlist@example.com",
			password="wishlist-test-password",
		)
		category = Category.objects.create(name="Wishlist")
		products = [
			Product.objects.create(name=f"Wishlist product {index}", category=category)
			for index in range(3)
		]
		for index, product in enumerate(products):
			ProductVariant.objects.create(
				product=product,
				size="M",
				color="Black",
				sku=f"WISHLIST-{index}",
				price=Decimal(100 + index),
				stock=1,
			)
			WishlistItem.objects.create(user=user, product=product)
		self.client.force_authenticate(user)

		with self.assertNumQueries(3):
			response = self.client.get("/api/shop/wishlist/")

		self.assertEqual(response.status_code, 200)
		self.assertEqual(len(response.data["items"]), 3)
		self.assertEqual(
			sorted(item["price"] for item in response.data["items"]),
			["100.00", "101.00", "102.00"],
		)


class WishlistVariantTests(APITestCase):
	def setUp(self):
		self.user = User.objects.create_user(
			email="wishlist-variant@example.com",
			password="test-password",
		)
		self.client.force_authenticate(self.user)
		category = Category.objects.create(name="Wishlist variants")
		self.product = Product.objects.create(
			name="Wishlist variant product",
			category=category,
		)
		self.variant = ProductVariant.objects.create(
			product=self.product,
			size="M",
			color="Blue",
			sku="WISHLIST-VARIANT-M-BLUE",
			price=Decimal("25.00"),
			stock=4,
		)

	def test_wishlist_saves_and_returns_selected_variant(self):
		response = self.client.post(
			"/api/shop/wishlist/",
			{"product_id": self.product.pk, "variant_id": self.variant.pk},
			format="json",
		)

		self.assertEqual(response.status_code, 201)
		self.assertEqual(response.data["variant_id"], self.variant.pk)
		self.assertEqual(response.data["size"], "M")
		self.assertEqual(response.data["color"], "Blue")
		self.assertEqual(response.data["price"], "25.00")

		list_response = self.client.get("/api/shop/wishlist/")
		self.assertEqual(list_response.status_code, 200)
		self.assertEqual(list_response.data["items"][0]["variant_id"], self.variant.pk)

	def test_wishlist_updates_existing_product_to_selected_variant(self):
		WishlistItem.objects.create(user=self.user, product=self.product)

		response = self.client.post(
			"/api/shop/wishlist/",
			{"product_id": self.product.pk, "variant_id": self.variant.pk},
			format="json",
		)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data["variant_id"], self.variant.pk)
		self.assertEqual(WishlistItem.objects.filter(user=self.user).count(), 1)

	def test_wishlist_rejects_variant_from_another_product(self):
		other_product = Product.objects.create(
			name="Different wishlist product",
			category=self.product.category,
		)

		response = self.client.post(
			"/api/shop/wishlist/",
			{"product_id": other_product.pk, "variant_id": self.variant.pk},
			format="json",
		)

		self.assertEqual(response.status_code, 404)
		self.assertFalse(WishlistItem.objects.filter(product=other_product).exists())
