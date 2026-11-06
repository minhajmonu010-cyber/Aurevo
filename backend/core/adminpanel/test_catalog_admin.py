import io
import shutil
import tempfile
from decimal import Decimal
from unittest.mock import patch

from django.core.cache import cache
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from account.models import User
from adminpanel.analytics import category_shares
from catalog.models import Brand, Category, InventoryLog, Product, ProductImage, ProductVariant
from orders.models import Order, OrderItem

BASE = "/api/admin/catalog"
PASSWORD = "Adm1n-Store-2026"
MEDIA = tempfile.mkdtemp()


def picture(name="p.png", fmt="PNG", color=(200, 60, 90)):
    buffer = io.BytesIO()
    Image.new("RGB", (60, 60), color).save(buffer, fmt)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=f"image/{fmt.lower()}")


@override_settings(MEDIA_ROOT=MEDIA)
class CatalogAdminBase(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(email="boss@example.com", password=PASSWORD, first_name="Boss", is_staff=True, is_verified=True)
        self.customer = User.objects.create_user(email="shopper@example.com", password=PASSWORD, first_name="Shopper", is_verified=True)
        self.sign_in(self.admin)

    def sign_in(self, user):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")

    def category(self, name="Streetwear", **extra):
        return Category.objects.create(name=name, **extra)

    def product(self, category, name="Tee", sku=None, prices=(1000,), stock=20, **extra):
        product = Product.objects.create(name=name, category=category, sku=sku, **extra)
        for index, price in enumerate(prices):
            ProductVariant.objects.create(
                product=product, size=["S", "M", "L", "XL"][index], color="Black",
                sku=f"{sku or name}-{index}".upper().replace(" ", "-"), price=Decimal(price), stock=stock,
            )
        return product


class PermissionTests(CatalogAdminBase):
    def test_only_admins_get_in(self):
        for url in [f"{BASE}/categories/", f"{BASE}/products/", f"{BASE}/categories/stats/", f"{BASE}/products/stats/"]:
            self.client.credentials()
            self.assertEqual(self.client.get(url).status_code, 401, url)
            self.sign_in(self.customer)
            self.assertEqual(self.client.get(url).status_code, 403, url)
            self.sign_in(self.admin)
            self.assertEqual(self.client.get(url).status_code, 200, url)


class CategoryAdminTests(CatalogAdminBase):
    def post(self, **body):
        return self.client.post(f"{BASE}/categories/", body, format="json")

    def test_create_fills_in_the_defaults(self):
        first = self.post(name="Cyberpunk Utility", description="Technical layers.")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data["slug"], "cyberpunk-utility")
        self.assertTrue(first.data["is_active"])
        self.assertEqual(first.data["priority"], 1)
        self.assertEqual(self.post(name="Second").data["priority"], 2)  # the next free place
        self.assertEqual(self.post(name="Third", priority=1).data["priority"], 1)  # unless chosen

    def test_names_are_unique_ignoring_capitals(self):
        self.post(name="Old Money")
        r = self.post(name="  old   MONEY ")
        self.assertEqual(r.status_code, 400)
        self.assertIn("name", r.data)

    def test_category_image_must_be_a_valid_picture(self):
        image = SimpleUploadedFile("not-an-image.png", b"not an image", content_type="image/png")
        response = self.client.post(
            f"{BASE}/categories/",
            {"name": "Image validation", "image": image},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Category.objects.filter(name="Image validation").exists())

    def test_parent_cannot_loop_or_be_the_archive(self):
        top = self.category("Top")
        child = self.category("Child", parent=top)
        r = self.client.patch(f"{BASE}/categories/{top.pk}/", {"parent": child.pk}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.patch(f"{BASE}/categories/{top.pk}/", {"parent": top.pk}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.patch(f"{BASE}/categories/{child.pk}/", {"parent": Category.archive().pk}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.patch(f"{BASE}/categories/{child.pk}/", {"parent": None}, format="json")
        self.assertEqual(r.status_code, 200)
        r = self.client.patch(f"{BASE}/categories/{child.pk}/", {"parent": ""}, format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        child.refresh_from_db()
        self.assertIsNone(child.parent_id)

    def test_flags_and_status_can_be_edited(self):
        c = self.category()
        r = self.client.patch(
            f"{BASE}/categories/{c.pk}/",
            {"is_active": False, "is_featured": True, "in_search_suggest": False, "members_only": True, "priority": 4},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        c.refresh_from_db()
        self.assertEqual((c.is_active, c.is_featured, c.in_search_suggest, c.members_only, c.priority), (False, True, False, True, 4))

    def test_public_categories_expose_search_suggestion_setting(self):
        category = self.category("Search picks", in_search_suggest=True)
        self.product(category)

        response = self.client.get("/api/catalog/categories/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["slug"], category.slug)
        self.assertTrue(response.data[0]["in_search_suggest"])

    def test_public_categories_include_active_categories_without_products(self):
        empty_category = self.category("Coming soon")
        self.category("Hidden", is_active=False)

        response = self.client.get("/api/catalog/categories/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["name"] for item in response.data], ["Coming soon"])
        self.assertEqual(response.data[0]["product_count"], 0)

    def test_list_search_status_sort_and_the_archive_is_hidden(self):
        big, small = self.category("Streetwear", priority=2), self.category("Linen", priority=1, is_active=False)
        for n in range(3):
            self.product(big, name=f"Tee {n}", sku=f"S{n}")
        self.product(small, name="Shirt", sku="L1")
        Category.archive()

        r = self.client.get(f"{BASE}/categories/")
        self.assertEqual([c["name"] for c in r.data["results"]], ["Linen", "Streetwear"])  # by priority; no archive
        self.assertIn(r.data["share_basis"], ("sales", "products"))
        self.assertEqual([c["name"] for c in self.client.get(f"{BASE}/categories/?sort=products_desc").data["results"]], ["Streetwear", "Linen"])
        self.assertEqual([c["name"] for c in self.client.get(f"{BASE}/categories/?status=blocked").data["results"]], ["Linen"])
        self.assertEqual([c["name"] for c in self.client.get(f"{BASE}/categories/?status=active").data["results"]], ["Streetwear"])
        self.assertEqual([c["name"] for c in self.client.get(f"{BASE}/categories/?search=street").data["results"]], ["Streetwear"])
        by_name = {c["name"]: c for c in self.client.get(f"{BASE}/categories/").data["results"]}
        self.assertEqual(by_name["Streetwear"]["product_count"], 3)
        self.assertEqual(by_name["Streetwear"]["share"], 75)  # no sales yet: share of the products
        self.assertEqual(by_name["Linen"]["share"], 25)

    def test_category_shares_are_calculated_once_per_list_request(self):
        with patch(
            "adminpanel.catalog_views.category_shares",
            wraps=category_shares,
        ) as calculate_shares:
            response = self.client.get(f"{BASE}/categories/")

        self.assertEqual(response.status_code, 200)
        calculate_shares.assert_called_once_with()

    def test_stats(self):
        a, b = self.category("A", is_featured=True), self.category("B", is_active=False)
        self.product(a, name="P1", sku="P1")
        archived = self.product(Category.archive(), name="P2", sku="P2")
        stats = self.client.get(f"{BASE}/categories/stats/").data
        self.assertEqual((stats["total"], stats["active"], stats["health"], stats["featured"]), (2, 1, 50.0, 1))
        self.assertEqual((stats["tagged_products"], stats["pending_assign"]), (1, 1))
        self.assertEqual(stats["top"]["name"], "A")

    def test_reorder(self):
        a, b, c = self.category("A"), self.category("B"), self.category("C")
        r = self.client.post(f"{BASE}/categories/reorder/", {"order": [c.pk, a.pk, b.pk]}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual([x.name for x in Category.objects.filter(is_system=False)], ["C", "A", "B"])
        for bad in [{"order": [a.pk, a.pk]}, {"order": [a.pk, 9999]}, {"order": []}, {"order": "x"}, {}]:
            self.assertEqual(self.client.post(f"{BASE}/categories/reorder/", bad, format="json").status_code, 400, bad)

    def test_deleting_moves_the_products_to_the_archive(self):
        doomed, other = self.category("Old Money"), self.category("Casual")
        child = self.category("Child", parent=doomed)
        for n in range(2):
            self.product(doomed, name=f"P{n}", sku=f"D{n}")
        keep = self.product(other, name="Keep", sku="K1")
        order = Order.objects.create(user=self.customer, total_amount=Decimal(10))
        item = OrderItem.objects.create(order=order, category=doomed, product_name="x", quantity=1, price=Decimal(10), total_price=Decimal(10))

        r = self.client.delete(f"{BASE}/categories/{doomed.pk}/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["deleted"], r.data["reassigned"], r.data["archive"]), ("Old Money", 2, "Uncategorized Archive"))
        self.assertEqual(r.data["deleted_by"], "boss@example.com")
        self.assertFalse(Category.objects.filter(pk=doomed.pk).exists())
        self.assertEqual(Product.objects.filter(category=Category.archive()).count(), 2)
        keep.refresh_from_db()
        self.assertEqual(keep.category, other)
        child.refresh_from_db()
        self.assertIsNone(child.parent)  # became top-level
        item.refresh_from_db()
        self.assertIsNone(item.category)  # the order line stays

    def test_the_archive_is_protected(self):
        archive = Category.archive()
        self.assertEqual(self.client.delete(f"{BASE}/categories/{archive.pk}/").status_code, 409)
        self.assertEqual(self.client.patch(f"{BASE}/categories/{archive.pk}/", {"name": "x"}, format="json").status_code, 400)

    def test_the_picture_is_checked_and_can_be_removed(self):
        r = self.client.post(f"{BASE}/categories/", {"name": "With Photo", "image": picture()}, format="multipart")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data["image"].startswith("http"))
        category = Category.objects.get(pk=r.data["id"])
        old_image = category.image.name
        replaced = self.client.patch(
            f"{BASE}/categories/{category.pk}/",
            {"image": picture("replacement.png", color=(10, 20, 30))},
            format="multipart",
        )
        self.assertEqual(replaced.status_code, 200, replaced.data)
        category.refresh_from_db()
        self.assertNotEqual(category.image.name, old_image)
        self.assertFalse(default_storage.exists(old_image))
        bad = self.client.post(f"{BASE}/categories/", {"name": "Bad", "image": SimpleUploadedFile("a.txt", b"hello", "text/plain")}, format="multipart")
        self.assertEqual(bad.status_code, 400)
        gone = self.client.patch(f"{BASE}/categories/{category.pk}/", {"remove_image": True}, format="multipart")
        self.assertEqual(gone.status_code, 200)
        self.assertFalse(Category.objects.get(pk=category.pk).image)

    def test_blocking_a_category_hides_it_and_its_products_from_shoppers(self):
        c = self.category("Linen")
        self.product(c, name="Linen Shirt", sku="LS1")
        self.client.credentials()
        self.assertEqual([x["name"] for x in self.client.get("/api/catalog/categories/").data], ["Linen"])
        self.assertEqual(self.client.get("/api/catalog/products/").data["count"], 1)

        self.sign_in(self.admin)
        self.client.patch(f"{BASE}/categories/{c.pk}/", {"is_active": False}, format="json")
        self.client.credentials()
        self.assertEqual(self.client.get("/api/catalog/categories/").data, [])
        self.assertEqual(self.client.get("/api/catalog/products/").data["count"], 0)


class ProductAdminTests(CatalogAdminBase):
    def setUp(self):
        super().setUp()
        self.cat = self.category("Streetwear")

    def create(self, **extra):
        body = {"name": "Heavyweight Boxy Tee", "category": self.cat.pk, "sku": "oft-tee-043", **extra}
        return self.client.post(f"{BASE}/products/", body, format="json")

    def test_product_accepts_at_most_three_images(self):
        product = self.product(self.cat)
        endpoint = f"{BASE}/products/{product.pk}/images/"

        for index in range(3):
            response = self.client.post(
                endpoint,
                {"image": picture(f"photo-{index}.png")},
                format="multipart",
            )
            self.assertEqual(response.status_code, 201, response.data)

        extra = self.client.post(endpoint, {"image": picture("extra.png")}, format="multipart")
        self.assertEqual(extra.status_code, 400, extra.data)
        self.assertIn("image", extra.data)
        self.assertEqual(product.images.count(), 3)

        first_image = product.images.first()
        self.assertEqual(self.client.delete(f"{BASE}/images/{first_image.pk}/").status_code, 204)
        replacement = self.client.post(endpoint, {"image": picture("replacement.png")}, format="multipart")
        self.assertEqual(replacement.status_code, 201, replacement.data)
        self.assertEqual(product.images.count(), 3)

    def test_existing_product_image_can_be_replaced(self):
        product = self.product(self.cat)
        created = self.client.post(
            f"{BASE}/products/{product.pk}/images/",
            {"image": picture("before.png")},
            format="multipart",
        )
        self.assertEqual(created.status_code, 201, created.data)
        image = ProductImage.objects.get(pk=created.data["id"])
        old_name = image.image.name

        updated = self.client.patch(
            f"{BASE}/images/{image.pk}/",
            {"image": picture("after.png", color=(10, 20, 30))},
            format="multipart",
        )

        self.assertEqual(updated.status_code, 200, updated.data)
        image.refresh_from_db()
        self.assertNotEqual(image.image.name, old_name)
        self.assertTrue(default_storage.exists(image.image.name))
        self.assertFalse(default_storage.exists(old_name))
        self.assertEqual(product.images.count(), 1)

    def test_create_with_variants_makes_skus_and_stock_logs(self):
        r = self.create(
            collection="Drop 04", cost_price="310.00", low_stock_threshold=8, meta_title="Tee", meta_description="A tee.",
            new_variants=[
                {"size": "M", "color": "Acid Black", "price": "54.00", "original_price": "65.00", "stock": 120},
                {"size": "L", "color": "Acid Black", "price": "54.00", "stock": 0},
            ],
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["sku"], "OFT-TEE-043")  # upper-cased
        self.assertEqual(r.data["total_stock"], 120)
        skus = sorted(v["sku"] for v in r.data["variants"])
        self.assertEqual(skus, ["OFT-TEE-043-L-ACID-BLACK", "OFT-TEE-043-M-ACID-BLACK"])
        product = Product.objects.get(pk=r.data["id"])
        self.assertEqual((product.collection, product.cost_price, product.low_stock_threshold), ("Drop 04", Decimal("310.00"), 8))
        logs = InventoryLog.objects.filter(variant__product=product)
        self.assertEqual([(l.type, l.quantity) for l in logs], [("IN", 120)])  # only the variant that had stock

    def test_a_failed_variant_creates_nothing(self):
        r = self.create(new_variants=[{"size": "M", "color": "Black", "price": "10"}, {"size": "m", "color": "black", "price": "10"}])
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Product.objects.count(), 0)

    def test_variant_rules(self):
        for variant in [
            {"size": "M", "color": "Black", "price": "0"},
            {"size": "M", "color": "Black", "price": "50", "original_price": "40"},
            {"size": "M", "color": "Black", "price": "50", "stock": -1},
        ]:
            self.assertEqual(self.create(sku="X1", new_variants=[variant]).status_code, 400, variant)
        self.create(sku="TAKEN-1", new_variants=[{"size": "M", "color": "Black", "price": "50", "sku": "dup-1"}])
        r = self.create(name="Other", sku="X2", new_variants=[{"size": "S", "color": "Black", "price": "50", "sku": "DUP-1"}])
        self.assertEqual(r.status_code, 400)

    def test_product_sku_is_unique_but_optional(self):
        self.assertEqual(self.create().status_code, 201)
        self.assertEqual(self.create(name="Other", sku="OFT-TEE-043").status_code, 400)
        self.assertEqual(self.create(name="Third", sku="  ").status_code, 201)
        self.assertEqual(self.create(name="Fourth", sku="").status_code, 201)  # several products without a code is fine
        self.assertEqual(Product.objects.filter(sku__isnull=True).count(), 2)

    def test_the_archive_cannot_be_picked_as_a_category(self):
        r = self.client.post(f"{BASE}/products/", {"name": "X", "category": Category.archive().pk}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("category", r.data)

    def test_product_form_rejects_boolean_ids_and_numeric_values(self):
        invalid_payloads = [
            {"category": True},
            {"low_stock_threshold": True},
            {"cost_price": True},
            {"new_variants": [{"size": "M", "color": "Black", "price": True}]},
        ]
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                response = self.create(**payload)
                self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Product.objects.exists())

    def test_edit_the_new_fields(self):
        p = self.product(self.cat, name="Tee", sku="T1")
        r = self.client.patch(
            f"{BASE}/products/{p.pk}/",
            {"collection": "FW23", "cost_price": "310.00", "low_stock_threshold": 5, "meta_title": "SEO title", "is_active": False},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        p.refresh_from_db()
        self.assertEqual((p.collection, p.low_stock_threshold, p.meta_title, p.is_active), ("FW23", 5, "SEO title", False))
        self.assertEqual(self.client.patch(f"{BASE}/products/{p.pk}/", {"cost_price": "-1"}, format="json").status_code, 400)

    def test_list_filters_and_sorting(self):
        brand = Brand.objects.create(name="Aurevo")
        cheap = self.product(self.cat, name="Cheap Tee", sku="C1", prices=(500,), stock=50)
        pricey = self.product(self.cat, name="Pricey Coat", sku="P1", prices=(5000,), stock=4, brand=brand)  # 4 <= 10: low
        sold_out = self.product(self.cat, name="Sold Out", sku="S1", prices=(900,), stock=0, is_active=False)
        other = self.product(self.category("Linen"), name="Linen Shirt", sku="L1", prices=(1500,), stock=30)

        def names(query):
            return [p["name"] for p in self.client.get(f"{BASE}/products/?{query}").data["results"]]

        self.assertEqual(names("sort=price_asc"), ["Cheap Tee", "Sold Out", "Linen Shirt", "Pricey Coat"])
        self.assertEqual(names("sort=price_desc")[0], "Pricey Coat")
        self.assertEqual(names("sort=stock_asc")[0], "Sold Out")
        self.assertEqual(names("sort=name"), ["Cheap Tee", "Linen Shirt", "Pricey Coat", "Sold Out"])
        self.assertEqual(sorted(names(f"category={self.cat.pk}")), ["Cheap Tee", "Pricey Coat", "Sold Out"])
        self.assertEqual(names(f"brand={brand.pk}"), ["Pricey Coat"])
        self.assertEqual(names("status=hidden"), ["Sold Out"])
        self.assertEqual(sorted(names("status=active")), ["Cheap Tee", "Linen Shirt", "Pricey Coat"])
        self.assertEqual(sorted(names("stock=low")), ["Pricey Coat", "Sold Out"])
        self.assertEqual(names("stock=out"), ["Sold Out"])
        self.assertEqual(names("search=l1"), ["Linen Shirt"])  # by SKU
        self.assertEqual(names("search=pricey"), ["Pricey Coat"])
        row = {p["name"]: p for p in self.client.get(f"{BASE}/products/").data["results"]}
        self.assertEqual(
            (row["Pricey Coat"]["stock_status"], row["Sold Out"]["stock_status"], row["Cheap Tee"]["stock_status"]),
            ("low", "out", "ok"),
        )
        self.assertEqual(row["Pricey Coat"]["sku"], "P1")
        self.assertEqual(self.client.get(f"{BASE}/products/").data["count"], 4)

    def test_product_list_query_count_does_not_scale_with_variant_count(self):
        product = self.product(
            self.cat,
            name="Many variants",
            sku="MANY",
            prices=(1000, 1100, 1200, 1300),
        )
        ProductImage.objects.create(product=product, image=picture("many.png"), is_primary=True)
        self.client.force_authenticate(user=self.admin)

        with self.assertNumQueries(3):
            response = self.client.get(f"{BASE}/products/?page_size=100")

        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.data["results"] if item["id"] == product.id)
        self.assertEqual(
            (row["min_price"], row["max_price"], row["total_stock"], row["variant_count"], row["stock_status"]),
            ("1000.00", "1300.00", 80, 4, "ok"),
        )

    def test_stats(self):
        self.product(self.cat, name="A", sku="A1", prices=(1000,), stock=50)
        self.product(self.cat, name="B", sku="B1", prices=(2000,), stock=2, is_active=False)
        self.client.force_authenticate(user=self.admin)
        with self.assertNumQueries(1):
            response = self.client.get(f"{BASE}/products/stats/")
        stats = response.data
        self.assertEqual((stats["total"], stats["active"], stats["hidden"], stats["low_stock"]), (2, 1, 1, 1))
        self.assertEqual(stats["average_price"], "1500.00")

    def test_deleting_returns_a_summary_and_keeps_the_order_history(self):
        p = self.product(self.cat, name="Midnight Bomber", sku="MB1", prices=(980, 980), stock=27)
        ProductImage.objects.create(product=p, image=picture().name and "products/x.png", is_primary=True)
        variant = p.variants.first()
        order = Order.objects.create(user=self.customer, total_amount=Decimal(980))
        line = OrderItem.objects.create(
            order=order, variant=variant, category=self.cat, product_name="Midnight Bomber", sku=variant.sku,
            quantity=1, price=Decimal(980), total_price=Decimal(980),
        )
        r = self.client.delete(f"{BASE}/products/{p.pk}/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["deleted"], r.data["variants_removed"], r.data["images_removed"], r.data["stock_removed"]), ("Midnight Bomber", 2, 1, 54))
        self.assertFalse(Product.objects.filter(pk=p.pk).exists())
        line.refresh_from_db()  # the order still reads correctly
        self.assertEqual((line.product_name, line.sku, line.total_price), ("Midnight Bomber", variant.sku, Decimal(980)))
        self.assertIsNone(line.variant)

    def test_stock_endpoint_still_logs_every_change(self):
        p = self.product(self.cat, name="Tee", sku="T1", stock=5)
        v = p.variants.first()
        r = self.client.post(f"{BASE}/variants/{v.pk}/stock/", {"type": "OUT", "quantity": 2, "note": "damaged"}, format="json")
        self.assertEqual((r.status_code, r.data["stock"]), (200, 3))
        self.assertEqual(self.client.post(f"{BASE}/variants/{v.pk}/stock/", {"type": "OUT", "quantity": 9}, format="json").status_code, 400)

    def test_inventory_includes_product_image_and_adjustment_updates_stock(self):
        product = self.product(self.cat, name="Tee", sku="T1", stock=5)
        ProductImage.objects.create(product=product, image=picture("tee.png"), is_primary=True)
        variant = product.variants.first()

        inventory = self.client.get("/api/admin/auth/inventory/")
        self.assertEqual(inventory.status_code, 200)
        row = next(row for row in inventory.data["results"] if row["id"] == variant.pk)
        self.assertEqual(row["image"], "http://testserver/media/products/tee.png")
        self.assertEqual(inventory.data["count"], 1)
        self.assertEqual(inventory.data["summary"]["stock_units"], 5)
        self.assertEqual(inventory.data["summary"]["low_stock"], 1)

        adjustment = self.client.post(
            f"{BASE}/variants/{variant.pk}/stock/",
            {"type": "IN", "quantity": 4, "note": "Restock"},
            format="json",
        )
        self.assertEqual((adjustment.status_code, adjustment.data["stock"]), (200, 9))
        refreshed_inventory = self.client.get("/api/admin/auth/inventory/")
        refreshed_row = next(row for row in refreshed_inventory.data["results"] if row["id"] == variant.pk)
        self.assertEqual(refreshed_row["stock"], 9)

    def test_inventory_paginates_variants_but_keeps_full_filtered_summary(self):
        self.product(self.cat, name="Multi size", sku="MS1", prices=(1000, 1000), stock=12)

        first_page = self.client.get("/api/admin/auth/inventory/?page=1&page_size=1")
        second_page = self.client.get("/api/admin/auth/inventory/?page=2&page_size=1")

        self.assertEqual(first_page.data["count"], 2)
        self.assertEqual(len(first_page.data["results"]), 1)
        self.assertEqual(len(second_page.data["results"]), 1)
        self.assertNotEqual(first_page.data["results"][0]["id"], second_page.data["results"][0]["id"])
        self.assertEqual(first_page.data["summary"]["variant_count"], 2)
        self.assertEqual(first_page.data["summary"]["stock_units"], 24)

    def test_inventory_alerts_filter_returns_only_low_and_out_of_stock_variants(self):
        self.product(self.cat, name="Low stock", sku="LOW1", stock=2, low_stock_threshold=5)
        self.product(self.cat, name="Out of stock", sku="OUT1", stock=0)
        self.product(self.cat, name="Healthy stock", sku="OK1", stock=12)

        response = self.client.get(
            "/api/admin/auth/inventory/?status=alerts&page=1&page_size=12"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {row["status"] for row in response.data["results"]},
            {"low", "out"},
        )
        self.assertEqual(response.data["count"], 2)

    def test_inventory_query_count_is_bounded_and_summary_is_database_aggregated(self):
        for index in range(5):
            self.product(
                self.cat,
                name=f"Inventory batch {index}",
                sku=f"IB{index}",
                prices=(1000, 1100, 1200),
                stock=8,
            )
        self.client.force_authenticate(user=self.admin)

        with self.assertNumQueries(3):
            response = self.client.get("/api/admin/auth/inventory/?page=1&page_size=2")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 2)
        self.assertEqual(response.data["count"], 15)
        self.assertEqual(response.data["summary"]["stock_units"], 120)