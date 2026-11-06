from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from account.models import User
from catalog.models import Category, Product, ProductVariant
from adminpanel.analytics import dashboard_summary
from orders.models import Order, OrderItem, Payment

URL = "/api/admin/dashboard/"
ORDERS = "/api/admin/dashboard/orders/"
SALES_REPORT = "/api/admin/dashboard/sales-report/"
PASSWORD = "Adm1n-Store-2026"


class DashboardBase(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(email="boss@example.com", password=PASSWORD, first_name="Boss", is_staff=True, is_verified=True)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(self.admin).access_token}")
        self.category = Category.objects.create(name="Streetwear")
        self.product = Product.objects.create(name="Tee", category=self.category, sku="T1")

    def customer(self, name="Julian", last="Vance"):
        return User.objects.create_user(email=f"{name.lower()}.{last.lower()}@example.com", password=PASSWORD, first_name=name, last_name=last, is_verified=True)

    def variant(self, stock=20, size="M", product=None):
        product = product or self.product
        return ProductVariant.objects.create(product=product, size=size, color="Black", sku=f"{product.sku}-{size}-{stock}", price=Decimal(100), stock=stock)

    def place(self, user, total, status="delivered", payment="paid", days_ago=0, variant=None, quantity=1):
        when = timezone.now() - timedelta(days=days_ago)
        order = Order.objects.create(user=user, total_amount=Decimal(total), order_status=status)
        Order.objects.filter(pk=order.pk).update(created_at=when)
        Payment.objects.create(order=order, amount=Decimal(total), payment_status=payment, paid_at=when if payment == "paid" else None)
        if variant:
            OrderItem.objects.create(
                order=order, variant=variant, category=self.category, product_name=variant.product.name, sku=variant.sku,
                quantity=quantity, price=variant.price, total_price=variant.price * quantity,
            )
        return order

    def summary(self, query=""):
        return self.client.get(URL + query).data


class DashboardAccessTests(DashboardBase):
    def test_only_admins(self):
        for url in (URL, ORDERS):
            self.client.credentials()
            self.assertEqual(self.client.get(url).status_code, 401)
            shopper = self.customer()
            self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(shopper).access_token}")
            self.assertEqual(self.client.get(url).status_code, 403)
            User.objects.filter(pk=shopper.pk).delete()


class DashboardNumbersTests(DashboardBase):
    def test_summary_uses_bounded_database_queries(self):
        self.variant(stock=2)

        with self.assertNumQueries(10):
            dashboard_summary()

    def test_an_empty_shop_shows_zeros(self):
        d = self.summary()
        self.assertEqual(d["stats"]["total_sales"], {"value": "0.00", "change": None})
        self.assertEqual((d["stats"]["total_orders"]["value"], d["stats"]["total_customers"]["value"]), (0, 0))
        self.assertEqual(d["stats"]["low_stock"], {"count": 0, "critical": 0})
        self.assertEqual(d["low_stock_items"], [])
        self.assertIsNone(d["sales_chart"]["peak"])
        self.assertEqual(d["highlights"]["repeat_buyers"], 0)
        for key, length in [("7d", 7), ("30d", 30), ("12m", 12)]:
            self.assertEqual(len(self.summary(f"?range={key}")["sales_chart"]["points"]), length)
        self.assertEqual(self.summary("?range=bogus")["sales_chart"]["range"], "7d")

    def test_sales_orders_and_customers(self):
        a, b = self.customer("Aarav", "Nair"), self.customer("Priya", "Menon")
        self.place(a, 1000, "delivered", "paid", days_ago=0)
        self.place(b, 500, "shipped", "paid", days_ago=3)
        self.place(a, 400, "returned", "refunded", days_ago=5)  # money went back: not a sale
        self.place(b, 300, "cancelled", "failed", days_ago=2)  # not counted as an order
        self.place(a, 250, "pending", "pending", days_ago=1)
        self.place(b, 500, "delivered", "paid", days_ago=45)  # the month before

        stats = self.summary()["stats"]
        self.assertEqual(stats["total_sales"]["value"], "2000.00")  # 1000 + 500 + 500 paid
        self.assertEqual(stats["total_sales"]["change"], 200.0)  # last 30 days 1500 against 500 before
        self.assertEqual(stats["total_orders"]["value"], 5)  # 6 minus the cancelled one
        self.assertEqual(stats["total_orders"]["change"], 300.0)  # 4 in the last 30 days against 1
        self.assertEqual(stats["total_customers"]["value"], 2)  # staff are not customers

    def test_customer_growth_compares_signups(self):
        old = self.customer("Old", "Timer")
        User.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=40))
        self.customer("New", "One")
        self.customer("New", "Two")
        self.assertEqual(self.summary()["stats"]["total_customers"], {"value": 3, "change": 100.0})  # 2 now, 1 before

    def test_chart_adds_up_payments_per_day(self):
        user = self.customer()
        self.place(user, 700, days_ago=0)
        self.place(user, 300, days_ago=0)
        self.place(user, 900, days_ago=2)
        self.place(user, 5000, "returned", "refunded", days_ago=1)
        chart = self.summary()["sales_chart"]
        values = [Decimal(p["value"]) for p in chart["points"]]
        self.assertEqual(values[-1], Decimal(1000))  # today
        self.assertEqual(values[-3], Decimal(900))
        self.assertEqual(values[-2], Decimal(0))  # the refunded day
        self.assertEqual(chart["peak"], {"label": timezone.localdate().strftime("%A"), "value": "1000.00"})
        self.assertEqual(Decimal(self.summary("?range=12m")["sales_chart"]["points"][-1]["value"]), Decimal(1000 + 900) - (Decimal(900) if (timezone.localdate() - timedelta(days=2)).month != timezone.localdate().month else 0))

    def test_low_stock(self):
        self.variant(stock=2, size="S")  # critical
        self.variant(stock=5, size="M")  # low
        self.variant(stock=11, size="L")  # fine (threshold is 10)
        hidden = Product.objects.create(name="Hidden", category=self.category, sku="H1", is_active=False)
        self.variant(stock=1, product=hidden)  # not counted: the product is hidden
        picky = Product.objects.create(name="Picky", category=self.category, sku="P1", low_stock_threshold=30)
        self.variant(stock=25, product=picky)  # low for ITS threshold

        d = self.summary()
        self.assertEqual(d["stats"]["low_stock"], {"count": 3, "critical": 1})
        self.assertEqual([(i["name"], i["size"], i["stock"], i["critical"]) for i in d["low_stock_items"]],
                         [("Tee", "S", 2, True), ("Tee", "M", 5, False), ("Picky", "M", 25, False)])
        self.assertEqual(d["low_stock_alerting"], 3)

    def test_highlights(self):
        a, b = self.customer("Aarav", "Nair"), self.customer("Priya", "Menon")
        stocked = self.variant(stock=7)
        self.place(a, 600, variant=stocked, quantity=2)
        self.place(a, 400, variant=stocked, quantity=1)
        self.place(b, 200, "cancelled", "failed", variant=stocked, quantity=5)  # cancelled: not sold
        h = self.summary()["highlights"]
        self.assertEqual(h["avg_order_value"]["value"], "500.00")  # (600 + 400) / 2 paid orders
        self.assertEqual(h["repeat_buyers"], 100.0)  # only Aarav bought, and twice
        self.assertEqual(h["sell_through"], 30.0)  # 3 sold, 7 left


class DashboardOrdersTests(DashboardBase):
    def setUp(self):
        super().setUp()
        self.julian, self.elena = self.customer("Julian", "Vance"), self.customer("Elena", "Rostova")
        self.orders = [self.place(self.julian if n % 2 else self.elena, 100 + n, days_ago=n) for n in range(7)]

    def rows(self, query=""):
        return self.client.get(ORDERS + query).data

    def test_newest_first_five_per_page(self):
        data = self.rows()
        self.assertEqual((data["count"], len(data["results"])), (7, 5))
        self.assertEqual(data["results"][0]["order_number"], self.orders[0].order_number)
        self.assertEqual(len(self.rows("?page=2")["results"]), 2)
        self.assertEqual(len(self.rows("?page_size=1000")["results"]), 7)

    def test_row_details(self):
        row = self.rows()["results"][0]
        self.assertEqual(row["customer"], {"name": "Elena Rostova", "email": "elena.rostova@example.com", "initials": "ER"})
        self.assertEqual((row["amount"], row["payment_status"], row["order_status"]), ("100.00", "paid", "delivered"))
        self.assertTrue(row["order_number"].startswith("AV-"))

    def test_items_count_sums_quantities_without_order_items(self):
        order = self.orders[0]
        variant = self.variant()
        OrderItem.objects.create(
            order=order,
            variant=variant,
            category=self.category,
            product_name=variant.product.name,
            sku=variant.sku,
            quantity=3,
            price=variant.price,
            total_price=variant.price * 3,
        )

        row = next(row for row in self.rows()["results"] if row["id"] == order.id)

        self.assertEqual(row["items_count"], 3)

    def test_search_and_filters(self):
        self.assertEqual(self.rows("?search=julian")["count"], 3)
        self.assertEqual(self.rows("?search=ROSTOVA")["count"], 4)
        self.assertEqual(self.rows(f"?search=%23{self.orders[2].order_number}")["count"], 1)  # "#AV-00003"
        Order.objects.filter(pk=self.orders[1].pk).update(order_status="shipped")
        self.assertEqual(self.rows("?status=shipped")["count"], 1)
        self.assertEqual(self.rows("?status=nonsense")["count"], 7)  # an unknown status is ignored
        Payment.objects.filter(order=self.orders[0]).update(payment_status="refunded")
        self.assertEqual(self.rows("?payment=refunded")["count"], 1)

    def test_order_date_filters_and_invalid_ranges(self):
        today = timezone.localdate()
        Order.objects.filter(pk=self.orders[0].pk).update(created_at=timezone.now())
        self.assertEqual(
            self.rows(f"?start={today.isoformat()}&end={today.isoformat()}")["count"],
            1,
        )
        self.assertEqual(self.client.get(ORDERS + "?start=invalid").status_code, 400)
        self.assertEqual(self.client.get(ORDERS + "?start=2026-99-99").status_code, 400)
        self.assertEqual(
            self.client.get(ORDERS + "?start=2026-02-02&end=2026-02-01").status_code,
            400,
        )

    def test_an_order_without_payment_is_pending_and_a_deleted_customer_is_shown(self):
        order = Order.objects.create(user=None, total_amount=Decimal(50))
        row = next(r for r in self.rows("?page_size=50")["results"] if r["id"] == order.id)
        self.assertEqual(row["payment_status"], "pending")
        self.assertEqual(row["customer"]["name"], "Deleted customer")


class SalesReportTests(DashboardBase):
    def report(self, start=None, end=None):
        today = timezone.localdate()
        return self.client.get(
            SALES_REPORT,
            {
                "start": (start or today).isoformat(),
                "end": (end or today).isoformat(),
            },
        )

    def test_report_summarizes_paid_orders_products_and_payment_methods(self):
        customer = self.customer()
        variant = self.variant(size="M")
        order = self.place(customer, 200, variant=variant, quantity=2)
        Order.objects.filter(pk=order.pk).update(
            discount_amount=Decimal("30.00"),
            coupon_discount_amount=Decimal("10.00"),
            shipping_charge=Decimal("5.00"),
            coupon_code="SAVE10",
        )
        Payment.objects.filter(order=order).update(payment_method="upi")
        self.place(customer, 900, payment="failed", variant=variant, quantity=9)

        response = self.report()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_sales"], Decimal("200.00"))
        self.assertEqual(response.data["payment_count"], 1)
        self.assertEqual(response.data["paid_order_count"], 1)
        self.assertEqual(response.data["average_order_value"], Decimal("200.00"))
        self.assertEqual(response.data["units_sold"], 2)
        self.assertEqual(response.data["product_revenue"], Decimal("200.00"))
        self.assertEqual(response.data["product_count"], 1)
        self.assertEqual(
            response.data["product_sales"][0],
            {
                "product_name": "Tee",
                "product_image": "",
                "sku": variant.sku,
                "size": "M",
                "color": "Black",
                "category__name": "Streetwear",
                "units_sold": 2,
                "revenue": Decimal("200.00"),
                "average_unit_price": Decimal("100.00"),
                "order_count": 1,
            },
        )
        self.assertEqual(
            response.data["payment_methods"],
            [{"method": "upi", "payment_count": 1, "amount": Decimal("200.00")}],
        )
        self.assertEqual(
            response.data["orders"][0],
            {
                "order_number": order.order_number,
                "created_at": order.created_at,
                "customer_name": "Julian Vance",
                "customer_email": "julian.vance@example.com",
                "shipping_address": {},
                "order_status": "delivered",
                "payment_method": "upi",
                "payment_status": "paid",
                "items": [
                    {
                        "product_name": "Tee",
                        "sku": variant.sku,
                        "size": "M",
                        "color": "Black",
                        "quantity": 2,
                        "unit_price": Decimal("100.00"),
                        "line_total": Decimal("200.00"),
                        "is_cancelled": False,
                    }
                ],
                "item_subtotal": Decimal("200.00"),
                "product_offer_discount": Decimal("20.00"),
                "coupon_code": "SAVE10",
                "coupon_discount": Decimal("10.00"),
                "total_discount": Decimal("30.00"),
                "shipping_charge": Decimal("5.00"),
                "order_total": Decimal("200.00"),
                "paid_amount": Decimal("200.00"),
                "payments": [
                    {
                        "method": "upi",
                        "amount": Decimal("200.00"),
                        "transaction_id": "",
                        "paid_at": Payment.objects.get(order=order).paid_at,
                    }
                ],
            },
        )

    def test_report_excludes_cancelled_items_and_refunds_and_validates_dates(self):
        customer = self.customer()
        variant = self.variant(size="L")
        order = self.place(customer, 300, variant=variant, quantity=3)
        OrderItem.objects.filter(order=order).update(is_cancelled=True)
        self.place(customer, 500, payment=Payment.REFUNDED, variant=variant, quantity=5)

        response = self.report()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_sales"], Decimal("300.00"))
        self.assertEqual(response.data["paid_order_count"], 1)
        self.assertEqual(response.data["units_sold"], 0)
        self.assertEqual(response.data["product_sales"], [])
        self.assertEqual(
            self.client.get(SALES_REPORT, {"start": "not-a-date"}).status_code,
            400,
        )