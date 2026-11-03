from django.core.cache import cache
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from account.models import User

BASE = "/api/admin/auth"
PASSWORD = "Adm1n-Store-2026"


class AdminAuthTests(APITestCase):
    def setUp(self):
        cache.clear()  # reset throttle counters
        self.admin = User.objects.create_user(
            email="boss@example.com", password=PASSWORD, first_name="Boss", is_staff=True, is_verified=True
        )
        self.customer = User.objects.create_user(
            email="shopper@example.com", password=PASSWORD, first_name="Shopper", is_verified=True
        )

    def login(self, email, password=PASSWORD):
        return self.client.post(f"{BASE}/login/", {"email": email, "password": password}, format="json")

    def test_admin_can_log_in(self):
        r = self.login("Boss@Example.com")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)
        self.assertIn("refresh", r.data)
        self.assertTrue(r.data["user"]["is_staff"])
        self.admin.refresh_from_db()
        self.assertIsNotNone(self.admin.last_login)

    def test_customer_is_refused_even_with_right_password(self):
        r = self.login("shopper@example.com")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["code"], "not_admin")
        self.assertNotIn("access", r.data)

    def test_wrong_password_and_unknown_email_look_the_same(self):
        wrong = self.login("boss@example.com", "not-the-password")
        unknown = self.login("nobody@example.com")
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong.data["detail"], unknown.data["detail"])

    def test_disabled_admin_cannot_log_in(self):
        self.admin.is_active = False
        self.admin.save()
        self.assertEqual(self.login("boss@example.com").status_code, 401)

    def test_me_needs_a_staff_token(self):
        self.assertEqual(self.client.get(f"{BASE}/me/").status_code, 401)  # not logged in

        # a customer's token is not enough
        customer_token = str(RefreshToken.for_user(self.customer).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {customer_token}")
        self.assertEqual(self.client.get(f"{BASE}/me/").status_code, 403)

        # an admin token works
        self.client.credentials()
        token = self.login("boss@example.com").data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        r = self.client.get(f"{BASE}/me/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["email"], "boss@example.com")

    def test_admin_can_update_profile_but_not_access_fields(self):
        token = self.login("boss@example.com").data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

        response = self.client.patch(
            f"{BASE}/me/",
            {
                "first_name": "  Alex ",
                "last_name": "Admin ",
                "phone": "+919876543210",
                "email": "changed@example.com",
                "is_staff": False,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.admin.refresh_from_db()
        self.assertEqual(
            (self.admin.first_name, self.admin.last_name, self.admin.phone, self.admin.email, self.admin.is_staff),
            ("Alex", "Admin", "+919876543210", "boss@example.com", True),
        )

    def test_admin_profile_rejects_blank_name_and_duplicate_phone(self):
        other = User.objects.create_user(
            email="other-admin@example.com", password=PASSWORD, first_name="Other", phone="5551234", is_staff=True
        )
        token = self.login("boss@example.com").data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

        blank_name = self.client.patch(f"{BASE}/me/", {"first_name": "  "}, format="json")
        duplicate_phone = self.client.patch(f"{BASE}/me/", {"phone": other.phone}, format="json")
        self.assertEqual(blank_name.status_code, 400)
        self.assertEqual(duplicate_phone.status_code, 400)

    def test_admin_loses_access_when_staff_flag_is_removed(self):
        token = self.login("boss@example.com").data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(self.client.get(f"{BASE}/me/").status_code, 200)

        self.admin.is_staff = False
        self.admin.is_superuser = False
        self.admin.save()
        self.assertEqual(self.client.get(f"{BASE}/me/").status_code, 403)

    def test_logout_blacklists_the_refresh_token(self):
        refresh = self.login("boss@example.com").data["refresh"]
        self.assertEqual(self.client.post(f"{BASE}/logout/", {"refresh": refresh}, format="json").status_code, 205)
        r = self.client.post(f"{BASE}/token/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_login_is_rate_limited(self):
        statuses = [self.login("boss@example.com", "wrong-password").status_code for _ in range(12)]
        self.assertEqual(statuses[:10], [401] * 10)
        self.assertEqual(statuses[10], 429)