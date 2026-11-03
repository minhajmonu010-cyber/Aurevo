from decimal import Decimal

from rest_framework.test import APITestCase

from account.models import User
from orders.models import Order, Payment
from wallet.models import Wallet


BASE = "/api/admin/auth"


class AdminCustomerTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin-customers@example.com",
            password="Admin-Password-2026",
            first_name="Admin",
            is_staff=True,
        )
        self.customer = User.objects.create_user(
            email="repeat@example.com",
            password="Customer-Password-2026",
            first_name="Repeat",
            last_name="Buyer",
            phone="5550001001",
            is_verified=True,
        )
        self.other_customer = User.objects.create_user(
            email="new@example.com",
            password="Customer-Password-2026",
            first_name="New",
            phone="5550001002",
            is_active=False,
        )
        User.objects.create_user(
            email="other-admin@example.com",
            password="Admin-Password-2026",
            first_name="Other",
            is_staff=True,
        )
        self.client.force_authenticate(self.admin)

    def create_order(self, customer, amount, status=Order.DELIVERED):
        order = Order.objects.create(
            user=customer,
            total_amount=Decimal(amount),
            order_status=status,
        )
        Payment.objects.create(
            order=order,
            amount=Decimal(amount),
            payment_status=Payment.PAID,
        )
        return order

    def test_list_excludes_staff_and_reports_customer_summary(self):
        self.create_order(self.customer, "15.50")
        self.create_order(self.customer, "24.50")

        response = self.client.get(f"{BASE}/customers/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(response.data["summary"], {
            "total": 2,
            "active": 1,
            "verified": 1,
            "repeat": 1,
        })
        self.assertEqual(response.data["results"][0]["id"], self.other_customer.id)

    def test_list_filters_and_sorting(self):
        self.create_order(self.customer, "80.00")

        response = self.client.get(
            f"{BASE}/customers/",
            {"status": "verified", "sort": "spend"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], self.customer.id)
        self.assertEqual(response.data["results"][0]["total_spent"], "80.00")

    def test_detail_includes_recent_orders_and_wallet_balance(self):
        order = self.create_order(self.customer, "42.00")
        Wallet.objects.create(user=self.customer, balance=Decimal("12.75"))

        response = self.client.get(f"{BASE}/customers/{self.customer.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["wallet_balance"], "12.75")
        self.assertEqual(response.data["total_orders"], 1)
        self.assertEqual(response.data["orders"][0]["id"], order.id)
        self.assertEqual(response.data["orders"][0]["payment_status"], Payment.PAID)

    def test_status_update_preserves_aggregates_and_rejects_staff(self):
        self.create_order(self.customer, "35.00")

        response = self.client.patch(
            f"{BASE}/customers/{self.customer.id}/",
            {"is_active": False},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["customer"]["is_active"])
        self.assertEqual(response.data["customer"]["total_orders"], 1)
        self.assertEqual(response.data["customer"]["total_spent"], "35.00")
        self.assertEqual(
            self.client.patch(
                f"{BASE}/customers/{self.admin.id}/",
                {"is_active": False},
                format="json",
            ).status_code,
            404,
        )

    def test_status_update_requires_boolean(self):
        endpoint = f"{BASE}/customers/{self.customer.id}/"
        invalid_boolean = self.client.patch(endpoint, {"is_active": "false"}, format="json")
        invalid_shape = self.client.patch(endpoint, ["is_active"], format="json")

        self.assertEqual(invalid_boolean.status_code, 400)
        self.assertEqual(invalid_shape.status_code, 400)
