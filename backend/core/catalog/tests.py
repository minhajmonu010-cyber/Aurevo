import shutil
import tempfile
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from account.models import User
from adminpanel.models import Offer
from catalog.models import Brand, Category, Product, ProductImage, ProductVariant, Review

SHOP = "/api/catalog"
MEDIA = tempfile.mkdtemp()
PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82"
)


@override_settings(MEDIA_ROOT=MEDIA)
class ShopApiTests(APITestCase):
    """What a shopper can see. These rules decide whether a product added in the admin appears on the home page."""

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.cat = Category.objects.create(name="Streetwear", priority=2)

    def product(self, name="Tee", category=None, prices=((1000, None, 5),), **extra):
        product = Product.objects.create(name=name, category=category or self.cat, **extra)
        for index, (price, original, stock) in enumerate(prices):
            ProductVariant.objects.create(
                product=product, size=["S", "M", "L", "XL"][index], color="Black", sku=f"{name}-{index}".upper().replace(" ", "-"),
                price=Decimal(price), original_price=Decimal(original) if original else None, stock=stock,
            )
        return product

    def names(self, query=""):
        return [p["name"] for p in self.client.get(f"{SHOP}/products/{query}").data["results"]]

    # ---- what is visible
    def test_only_products_a_shopper_may_buy_are_listed(self):
        self.product("Visible")
        self.product("Switched off", is_active=False)
        self.product("Blocked category", category=Category.objects.create(name="Linen", is_active=False))
        self.product("In the archive", category=Category.archive())
        Product.objects.create(name="No sizes yet", category=self.cat)
        sold = self.product("Only dead sizes")
        sold.variants.update(is_active=False)
        self.assertEqual(self.names(), ["Visible"])

    def test_a_product_with_one_live_size_is_shown_at_that_size_price(self):
        product = self.product("Mixed", prices=((1500, None, 3), (900, None, 3)))
        product.variants.filter(price=900).update(is_active=False)
        row = self.client.get(f"{SHOP}/products/").data["results"][0]
        self.assertEqual(row["price"], "1500.00")

    def test_price_discount_stock_and_labels(self):
        brand = Brand.objects.create(name="Aurevo")
        self.product("Deal", prices=((1000, 2000, 0), (1200, 2400, 4)), brand=brand)
        row = self.client.get(f"{SHOP}/products/").data["results"][0]
        self.assertEqual((row["price"], row["original_price"], row["discount_percent"]), ("1000.00", "2000.00", 50))
        self.assertTrue(row["in_stock"])  # one size still has stock
        self.assertEqual((row["category"]["name"], row["category"]["slug"], row["brand"]), ("Streetwear", "streetwear", "Aurevo"))
        self.assertIsNone(row["image"])

        Product.objects.get(name="Deal").variants.update(stock=0)
        self.assertFalse(self.client.get(f"{SHOP}/products/").data["results"][0]["in_stock"])

    def test_product_detail_includes_its_active_offer_price(self):
        product = self.product("Offer detail", prices=((1000, None, 5),))
        now = timezone.now()
        Offer.objects.create(
            name="Detail deal",
            discount_type=Offer.PERCENTAGE,
            discount_value=Decimal("20.00"),
            applies_to=Offer.PRODUCTS,
            target_ids=[product.id],
            start_date=now - timedelta(days=1),
            end_date=now + timedelta(days=1),
            is_active=True,
        )

        response = self.client.get(f"{SHOP}/products/{product.slug}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["variants"][0]["offer_price"], "800.00")
        self.assertEqual(response.data["variants"][0]["offer_discount"], "200.00")
        self.assertEqual(response.data["variants"][0]["offer_name"], "Detail deal")

    def test_product_cards_include_average_approved_rating_and_review_count(self):
        reviewed = self.product("Reviewed", prices=((1000, None, 5), (1200, None, 5)))
        unrated = self.product("Unrated")
        user_model = get_user_model()
        for index, rating in enumerate((5, 4, 3)):
            user = user_model.objects.create_user(
                email=f"card-reviewer{index}@example.com",
                password="test-password",
            )
            Review.objects.create(
                user=user,
                product=reviewed,
                rating=rating,
                is_approved=True,
            )

        pending_user = user_model.objects.create_user(
            email="card-pending@example.com",
            password="test-password",
        )
        Review.objects.create(
            user=pending_user,
            product=reviewed,
            rating=1,
        )

        rows = {
            row["name"]: row
            for row in self.client.get(f"{SHOP}/products/").data["results"]
        }
        self.assertEqual(
            (rows[reviewed.name]["average_rating"], rows[reviewed.name]["review_count"]),
            (4.0, 3),
        )
        self.assertIsNone(rows[unrated.name]["average_rating"])
        self.assertEqual(rows[unrated.name]["review_count"], 0)

    def test_the_main_picture_is_a_full_address(self):
        product = self.product("Pic")
        ProductImage.objects.create(product=product, image=SimpleUploadedFile("a.png", PNG, "image/png"), is_primary=True)
        image = self.client.get(f"{SHOP}/products/").data["results"][0]["image"]
        self.assertTrue(image.startswith("http://testserver/media/products/"), image)

    # ---- filtering
    def test_featured_products_come_first_and_can_be_asked_for(self):
        self.product("Plain")
        self.product("Star", is_featured=True)
        self.assertEqual(self.names("?ordering=featured"), ["Star", "Plain"])
        self.assertEqual(self.names("?featured=true"), ["Star"])

    def test_category_search_and_ordering(self):
        other = Category.objects.create(name="Linen", priority=1)
        self.product("Boxy Tee", description="Heavy cotton")
        self.product("Linen Shirt", category=other, prices=((3000, None, 1),))
        self.assertEqual(self.names("?category=linen"), ["Linen Shirt"])
        self.assertEqual(self.names("?category=nothing-here"), [])
        self.assertEqual(self.names("?search=cotton"), ["Boxy Tee"])
        self.assertEqual(self.names("?search=LINEN"), ["Linen Shirt"])  # matches the name and the category
        self.assertEqual(self.names("?search=zzz"), [])
        self.assertEqual(self.names("?ordering=price_desc"), ["Linen Shirt", "Boxy Tee"])
        self.assertEqual(self.names("?ordering=price_asc"), ["Boxy Tee", "Linen Shirt"])

    def test_pages(self):
        for n in range(13):
            self.product(f"P{n:02d}", prices=((100 + n, None, 1),))
        data = self.client.get(f"{SHOP}/products/").data
        self.assertEqual((data["count"], len(data["results"])), (13, 12))
        self.assertIsNotNone(data["next"])
        self.assertEqual(len(self.client.get(f"{SHOP}/products/?page=2").data["results"]), 1)
        self.assertEqual(len(self.client.get(f"{SHOP}/products/?page_size=1").data["results"]), 1)

    # ---- categories
    def test_categories_are_the_live_ones_in_the_admins_order(self):
        first = Category.objects.create(name="Old Money", priority=1, is_featured=True, description="Quiet style.")
        self.product("A", category=self.cat)
        self.product("B", category=first)
        Category.objects.create(name="Empty", priority=0)
        self.product("C", category=Category.objects.create(name="Blocked", priority=0, is_active=False))
        self.product("D", category=Category.archive())
        data = self.client.get(f"{SHOP}/categories/").data
        self.assertEqual([c["name"] for c in data], ["Empty", "Old Money", "Streetwear"])
        self.assertEqual(data[0]["product_count"], 0)
        self.assertEqual((data[1]["is_featured"], data[1]["description"], data[1]["product_count"]), (True, "Quiet style.", 1))
        self.assertFalse(data[2]["is_featured"])

    def test_the_count_only_includes_products_a_shopper_can_buy(self):
        self.product("Live")
        self.product("Off", is_active=False)
        self.assertEqual(self.client.get(f"{SHOP}/categories/").data[0]["product_count"], 1)

    # ---- one product
    def test_product_page(self):
        self.product(
            "Boxy Tee",
            prices=((1000, 1500, 2), (1000, None, 0)),
            description="Heavy cotton",
            sku="BOX-TEE",
            collection="Autumn release",
        )
        ok = self.client.get(f"{SHOP}/products/boxy-tee/")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual([(v["size"], v["in_stock"]) for v in ok.data["variants"]], [("S", True), ("M", False)])
        self.assertEqual(ok.data["description"], "Heavy cotton")
        self.assertEqual(
            (ok.data["sku"], ok.data["collection"], ok.data["variants"][0]["sku"]),
            ("BOX-TEE", "Autumn release", "BOXY-TEE-0"),
        )
        self.product("Secret", is_active=False)
        self.assertEqual(self.client.get(f"{SHOP}/products/secret/").status_code, 404)

    def test_product_reviews_show_only_approved_reviews_and_include_rating_summary(self):
        product = self.product("Reviewed tee")
        user_model = get_user_model()
        ratings = [5, 4, 3, 5, 4, 2]
        for index, rating in enumerate(ratings):
            user = user_model.objects.create_user(
                email=f"reviewer{index}@example.com",
                password="test-password",
                first_name="Review",
                last_name=f"Customer {index}",
            )
            Review.objects.create(
                user=user,
                product=product,
                rating=rating,
                comment=f"Review comment {index}",
                is_approved=True,
            )

        pending_user = user_model.objects.create_user(
            email="pending@example.com",
            password="test-password",
        )
        Review.objects.create(
            user=pending_user,
            product=product,
            rating=1,
            comment="Not approved yet",
        )

        endpoint = f"{SHOP}/products/{product.slug}/reviews/"
        response = self.client.get(endpoint)

        self.assertEqual(response.status_code, 200)
        self.assertEqual((response.data["count"], len(response.data["results"])), (6, 5))
        self.assertEqual(response.data["average_rating"], 3.8)
        self.assertEqual(
            response.data["rating_distribution"],
            {"1": 0, "2": 1, "3": 1, "4": 2, "5": 2},
        )
        self.assertNotIn("pending@example.com", str(response.data))
        self.assertEqual(response.data["results"][0]["customer_name"], "Review Customer 5")
        self.assertIsNotNone(response.data["next"])
        second_page = self.client.get(response.data["next"])
        self.assertEqual(len(second_page.data["results"]), 1)
        self.assertEqual(self.client.post(endpoint, {}, format="json").status_code, 405)

    # ---- who may look
    def test_anyone_can_look_and_a_bad_old_token_does_not_block_the_page(self):
        self.product("Visible")
        self.assertEqual(self.client.get(f"{SHOP}/products/").status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer an.old.token")
        self.assertEqual(self.client.get(f"{SHOP}/products/").status_code, 200)
        self.assertEqual(self.client.get(f"{SHOP}/categories/").status_code, 200)

    def test_shoppers_cannot_change_anything(self):
        for method in (self.client.post, self.client.put, self.client.patch, self.client.delete):
            self.assertEqual(method(f"{SHOP}/products/", {}, format="json").status_code, 405)


@override_settings(MEDIA_ROOT=MEDIA)
class AdminToShopTests(APITestCase):
    """The whole chain: what the admin does appears (or disappears) in the shop straight away."""

    def setUp(self):
        admin = User.objects.create_user(email="boss@example.com", password="Adm1n-Store-2026", first_name="Boss", is_staff=True, is_verified=True)
        self.token = f"Bearer {RefreshToken.for_user(admin).access_token}"
        self.category = Category.objects.create(name="Casual")

    def admin(self, method, url, body=None):
        self.client.credentials(HTTP_AUTHORIZATION=self.token)
        response = getattr(self.client, method)(url, body, format="json")
        self.client.credentials()
        return response

    def shop_names(self):
        return [p["name"] for p in self.client.get(f"{SHOP}/products/").data["results"]]

    def test_admin_can_list_and_hide_a_customer_review(self):
        customer = User.objects.create_user(
            email="reviewer@example.com",
            password="Reviewer-Test-Password-2026",
            first_name="Review",
            last_name="Customer",
            is_verified=True,
        )
        product = Product.objects.create(name="Reviewed shirt", category=self.category)
        review = Review.objects.create(
            user=customer,
            product=product,
            rating=5,
            comment="Excellent fit.",
            is_approved=True,
        )

        response = self.admin("get", "/api/admin/auth/reviews/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["customer_name"], "Review Customer")
        hidden = self.admin("patch", f"/api/admin/auth/reviews/{review.id}/", {"is_approved": False})
        self.assertEqual(hidden.status_code, 200)
        review.refresh_from_db()
        self.assertFalse(review.is_approved)

    def test_admin_offer_is_public_with_its_selected_product_or_category_names(self):
        product = Product.objects.create(name="Targeted shirt", category=self.category)
        category = Category.objects.create(name="Targeted collection")
        now = timezone.now()
        common = {
            "discount_type": Offer.PERCENTAGE,
            "discount_value": "15.00",
            "start_date": (now - timedelta(days=1)).isoformat(),
            "end_date": (now + timedelta(days=1)).isoformat(),
            "is_active": True,
        }
        product_offer = self.admin("post", "/api/admin/auth/offers/", {
            **common,
            "name": "Product offer",
            "applies_to": Offer.PRODUCTS,
            "target_ids": [product.id],
        })
        category_offer = self.admin("post", "/api/admin/auth/offers/", {
            **common,
            "name": "Category offer",
            "applies_to": Offer.CATEGORIES,
            "target_ids": [category.id],
        })

        self.assertEqual(product_offer.status_code, 201, product_offer.data)
        self.assertEqual(category_offer.status_code, 201, category_offer.data)
        response = self.client.get(f"{SHOP}/offers/")
        offers_by_name = {offer["name"]: offer for offer in response.data}
        self.assertEqual(offers_by_name["Product offer"]["target_names"], ["Targeted shirt"])
        self.assertEqual(
            offers_by_name["Product offer"]["target_slugs"],
            [product.slug],
        )
        self.assertEqual(offers_by_name["Category offer"]["target_names"], ["Targeted collection"])
        self.assertEqual(
            offers_by_name["Category offer"]["target_slugs"],
            [category.slug],
        )

    def test_public_offer_targets_are_loaded_in_constant_queries(self):
        products = [
            Product.objects.create(name=f"Offer product {index}", category=self.category)
            for index in range(2)
        ]
        categories = [
            Category.objects.create(name=f"Offer category {index}")
            for index in range(2)
        ]
        now = timezone.now()
        common = {
            "discount_type": Offer.PERCENTAGE,
            "discount_value": Decimal("10.00"),
            "start_date": now - timedelta(days=1),
            "end_date": now + timedelta(days=1),
            "is_active": True,
        }
        for index, product in enumerate(products):
            Offer.objects.create(
                **common,
                name=f"Product offer {index}",
                applies_to=Offer.PRODUCTS,
                target_ids=[product.id],
            )
        for index, category in enumerate(categories):
            Offer.objects.create(
                **common,
                name=f"Category offer {index}",
                applies_to=Offer.CATEGORIES,
                target_ids=[category.id],
            )

        with self.assertNumQueries(3):
            response = self.client.get(f"{SHOP}/offers/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 4)

    def test_admin_offer_rejects_unknown_target_ids(self):
        now = timezone.now()
        response = self.admin("post", "/api/admin/auth/offers/", {
            "name": "Invalid target",
            "discount_type": Offer.PERCENTAGE,
            "discount_value": "15.00",
            "applies_to": Offer.PRODUCTS,
            "target_ids": [999999],
            "start_date": (now - timedelta(days=1)).isoformat(),
            "end_date": (now + timedelta(days=1)).isoformat(),
            "is_active": True,
        })

        self.assertEqual(response.status_code, 400)
        self.assertIn("target_ids", response.data)

    def test_add_hide_show_and_delete(self):
        created = self.admin("post", "/api/admin/catalog/products/", {
            "name": "Admin Made Shirt", "category": self.category.pk, "sku": "ADM-1",
            "new_variants": [{"size": "M", "color": "Black", "price": "1499.00", "original_price": "1999.00", "stock": 5}],
        })
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(self.shop_names(), ["Admin Made Shirt"])
        card = self.client.get(f"{SHOP}/products/").data["results"][0]
        self.assertEqual((card["price"], card["discount_percent"]), ("1499.00", 25))

        pid = created.data["id"]
        self.admin("patch", f"/api/admin/catalog/products/{pid}/", {"is_active": False})
        self.assertEqual(self.shop_names(), [])
        self.admin("patch", f"/api/admin/catalog/products/{pid}/", {"is_active": True})
        self.assertEqual(self.shop_names(), ["Admin Made Shirt"])

        self.admin("patch", f"/api/admin/catalog/categories/{self.category.pk}/", {"is_active": False})  # block the category
        self.assertEqual(self.shop_names(), [])
        self.assertEqual(self.client.get(f"{SHOP}/categories/").data, [])
        self.admin("patch", f"/api/admin/catalog/categories/{self.category.pk}/", {"is_active": True})

        self.admin("delete", f"/api/admin/catalog/products/{pid}/")
        self.assertEqual(self.shop_names(), [])