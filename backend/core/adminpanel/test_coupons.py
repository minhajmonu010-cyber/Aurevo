from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from account.models import User
from adminpanel.models import Coupon


class CouponAdminSummaryTests(APITestCase):
    def setUp(self):
        cache.clear()
        admin = User.objects.create_user(
            email="coupons-admin@example.com",
            password="Coupon-Test-Password-2026",
            first_name="Coupons",
            is_staff=True,
            is_verified=True,
        )
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}"
        )
        now = timezone.now()
        Coupon.objects.create(code="ACTIVE", discount_value=10, start_date=now - timedelta(days=1), end_date=now + timedelta(days=1))
        Coupon.objects.create(code="INACTIVE", discount_value=10, start_date=now - timedelta(days=1), end_date=now + timedelta(days=1), is_active=False)
        Coupon.objects.create(code="SCHEDULED", discount_value=10, start_date=now + timedelta(days=1), end_date=now + timedelta(days=2))
        Coupon.objects.create(code="EXPIRED", discount_value=10, start_date=now - timedelta(days=2), end_date=now - timedelta(days=1))
        Coupon.objects.create(code="USED", discount_value=10, usage_limit=1, used_count=1, start_date=now - timedelta(days=1), end_date=now + timedelta(days=1))

    def test_list_returns_global_status_summary_even_when_filtered(self):
        response = self.client.get("/api/admin/auth/coupons/?status=Active")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["summary"], {
            "total": 5,
            "active": 1,
            "scheduled": 1,
            "expired": 1,
            "inactive": 1,
            "used_up": 1,
        })

    def test_admin_can_create_coupon_with_form_fields(self):
        now = timezone.now()
        response = self.client.post(
            "/api/admin/auth/coupons/",
            {
                "code": "  new-customer20 ",
                "description": "New customer discount",
                "discount_type": "percentage",
                "discount_value": "20.00",
                "minimum_order_amount": "500.00",
                "usage_limit": 25,
                "start_date": now.isoformat(),
                "end_date": (now + timedelta(days=7)).isoformat(),
                "is_active": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["code"], "NEW-CUSTOMER20")
        self.assertEqual(response.data["status"], "Active")

    def test_coupon_rejects_invalid_limits_and_boolean_amounts(self):
        now = timezone.now()
        body = {
            "code": "INVALID-LIMIT",
            "discount_type": "fixed",
            "discount_value": True,
            "start_date": now.isoformat(),
            "end_date": (now + timedelta(days=1)).isoformat(),
        }
        response = self.client.post("/api/admin/auth/coupons/", body, format="json")
        self.assertEqual(response.status_code, 400, response.data)

        body.update(code="ZERO-LIMIT", discount_value="10.00", usage_limit=0)
        response = self.client.post("/api/admin/auth/coupons/", body, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Coupon.objects.filter(code__in=["INVALID-LIMIT", "ZERO-LIMIT"]).exists())