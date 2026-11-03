from django.test import TestCase
from decimal import Decimal

from rest_framework.test import APITestCase

from account.models import User
from catalog.models import Category, Product, ProductVariant
from .models import CartItem


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
