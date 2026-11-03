from decimal import Decimal

from django.core.cache import cache
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from account.models import User
from catalog.models import Category, InventoryLog, Product, ProductVariant
from orders.models import Order, OrderItem, OrderReturn, OrderStatusHistory, Payment
from wallet.models import Wallet, WalletTransaction


BASE = "/api/admin/auth/orders/"


class AdminOrdersTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(
            email="orders-admin@example.com",
            password="Strong-Test-Password-2026",
            first_name="Orders",
            is_staff=True,
            is_verified=True,
        )
        self.customer = User.objects.create_user(
            email="customer@example.com",
            password="Strong-Test-Password-2026",
            first_name="Casey",
            last_name="Customer",
            is_verified=True,
        )
        token = str(RefreshToken.for_user(self.admin).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        category = Category.objects.create(name="Order test category")
        product = Product.objects.create(name="Order test product", category=category, sku="ORDER-TEST")
        self.variant = ProductVariant.objects.create(
            product=product,
            size="M",
            color="Navy",
            sku="ORDER-TEST-M",
            price=Decimal("25.00"),
            stock=10,
        )
        self.order = Order.objects.create(
            user=self.customer,
            total_amount=Decimal("30.00"),
            shipping_charge=Decimal("5.00"),
            order_status=Order.PENDING,
            shipping_address={"city": "Pune"},
        )
        OrderItem.objects.create(
            order=self.order,
            variant=self.variant,
            category=category,
            product_name="Order test product",
            sku=self.variant.sku,
            size="M",
            color="Navy",
            quantity=1,
            price=Decimal("25.00"),
            total_price=Decimal("25.00"),
        )
        Payment.objects.create(
            order=self.order,
            amount=Decimal("30.00"),
            payment_status=Payment.PAID,
            payment_method="card",
        )

    def test_order_list_has_correct_status_payment_and_filtering(self):
        response = self.client.get(BASE, {"status": "pending", "payment": "paid", "search": "Casey"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["summary"]["total"], 1)
        self.assertEqual(response.data["results"][0]["order_status"], Order.PENDING)
        self.assertEqual(response.data["results"][0]["payment_status"], Payment.PAID)
        self.assertEqual(response.data["results"][0]["item_count"], 1)

    def test_order_details_and_fulfillment_update_write_history(self):
        detail = self.client.get(f"{BASE}{self.order.pk}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["shipping_address"]["city"], "Pune")
        self.assertEqual(detail.data["items"][0]["product_name"], "Order test product")

        response = self.client.patch(
            f"{BASE}{self.order.pk}/status/",
            {"status": Order.SHIPPED, "tracking_id": "TRACK-123", "delivery_date": "2026-10-25"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.order.refresh_from_db()
        self.assertEqual((self.order.order_status, self.order.tracking_id, str(self.order.delivery_date)), (Order.SHIPPED, "TRACK-123", "2026-10-25"))
        self.assertEqual(OrderStatusHistory.objects.filter(order=self.order, status=Order.SHIPPED).count(), 1)

    def test_admin_cancellation_restores_stock_once(self):
        self.variant.stock = 9
        self.variant.save(update_fields=["stock"])

        cancelled = self.client.patch(
            f"{BASE}{self.order.pk}/status/",
            {"status": Order.CANCELLED},
            format="json",
        )

        self.assertEqual(cancelled.status_code, 200, cancelled.data)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock, 10)
        self.assertEqual(
            InventoryLog.objects.filter(
                variant=self.variant,
                type=InventoryLog.IN,
                note__contains="Cancelled by admin",
            ).count(),
            1,
        )
        self.assertEqual(
            self.client.patch(
                f"{BASE}{self.order.pk}/status/",
                {"status": Order.CANCELLED},
                format="json",
            ).status_code,
            200,
        )
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock, 10)
        reopened = self.client.patch(
            f"{BASE}{self.order.pk}/status/",
            {"status": Order.PROCESSING},
            format="json",
        )
        self.assertEqual(reopened.status_code, 400)

    def test_invalid_filters_and_updates_return_validation_errors(self):
        self.assertEqual(self.client.get(BASE, {"start": "not-a-date"}).status_code, 400)
        self.assertEqual(self.client.get(BASE, {"start": "2026-10-02", "end": "2026-10-01"}).status_code, 400)
        invalid = self.client.patch(f"{BASE}{self.order.pk}/status/", {"status": "unknown"}, format="json")
        empty = self.client.patch(f"{BASE}{self.order.pk}/status/", {}, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(empty.status_code, 400)

    def test_admin_can_list_and_review_return_requests(self):
        self.variant.stock = 9
        self.variant.save(update_fields=["stock"])
        return_request = OrderReturn.objects.create(
            order=self.order,
            reason="Item arrived damaged.",
            refund_amount=self.order.total_amount,
        )

        response = self.client.get("/api/admin/auth/returns/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["summary"], {"total": 1, "requested": 1, "approved": 0, "rejected": 0})
        self.assertEqual(response.data["results"][0]["reason"], "Item arrived damaged.")

        response = self.client.patch(
            f"/api/admin/auth/returns/{return_request.pk}/status/",
            {"status": "approved"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        return_request.refresh_from_db()
        self.assertEqual(return_request.status, OrderReturn.APPROVED)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock, 10)
        self.assertEqual(
            InventoryLog.objects.filter(
                variant=self.variant,
                type=InventoryLog.IN,
                note__contains="approved return",
            ).count(),
            1,
        )
        wallet = Wallet.objects.get(user=self.customer)
        self.assertEqual(wallet.balance, self.order.total_amount)
        self.assertEqual(
            WalletTransaction.objects.filter(
                wallet=wallet,
                reference=f"return:{return_request.pk}",
                transaction_type=WalletTransaction.CREDIT,
            ).count(),
            1,
        )

        duplicate = self.client.patch(
            f"/api/admin/auth/returns/{return_request.pk}/status/",
            {"status": "approved"},
            format="json",
        )
        self.assertEqual(duplicate.status_code, 400)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, self.order.total_amount)
        self.assertEqual(wallet.transactions.count(), 1)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock, 10)

    def test_rejecting_a_return_does_not_credit_the_wallet(self):
        self.variant.stock = 9
        self.variant.save(update_fields=["stock"])
        return_request = OrderReturn.objects.create(
            order=self.order,
            reason="Item arrived damaged.",
            refund_amount=self.order.total_amount,
        )

        response = self.client.patch(
            f"/api/admin/auth/returns/{return_request.pk}/status/",
            {"status": "rejected"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Wallet.objects.filter(user=self.customer).exists())
        self.assertFalse(WalletTransaction.objects.exists())
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock, 9)
