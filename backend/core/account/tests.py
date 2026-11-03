import re
from unittest.mock import patch
from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from google.auth.exceptions import TransportError
from rest_framework.test import APITestCase
from .models import Address, PasswordOTP, User
import io
import os
import shutil
import tempfile
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image


BASE="/api/auth"
PASSWORD="Shirt-store-2026"

def last_code():
    return re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)


@override_settings(OTP_RESEND_SECONDS=0)
class AuthFlowTests(APITestCase):
    def setUp(self):
        cache.clear()  # reset throttle counters

    def signup(self, email="minhaj@example.com"):
        return self.client.post(
            f"{BASE}/signup/",
            {"full_name": "Minhaj", "email": email, "password": PASSWORD, "confirm_password": PASSWORD, "accepted_terms": True},
            format="json",
        )

    def test_signup_verify_login_me(self):
        self.assertEqual(self.signup().status_code, 201)
        code = last_code()

        # Signup verification is optional; a valid password can be used immediately.
        r = self.client.post(f"{BASE}/login/", {"email": "minhaj@example.com", "password": PASSWORD}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)
        self.assertFalse(User.objects.get(email="minhaj@example.com").is_verified)

        wrong = "000000" if code != "000000" else "111111"
        r = self.client.post(f"{BASE}/verify-otp/", {"email": "minhaj@example.com", "otp": wrong, "purpose": "signup"}, format="json")
        self.assertEqual(r.status_code, 400)

        r = self.client.post(f"{BASE}/verify-otp/", {"email": "minhaj@example.com", "otp": code, "purpose": "signup"}, format="json")
        self.assertEqual(r.status_code, 200)

        r = self.client.post(f"{BASE}/login/", {"email": "Minhaj@Example.com", "password": PASSWORD}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
        me = self.client.get(f"{BASE}/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data["email"], "minhaj@example.com")

    def test_me_requires_login(self):
        self.assertEqual(self.client.get(f"{BASE}/me/").status_code, 401)

    def test_duplicate_and_mismatch(self):
        User.objects.create_user(email="a@example.com", password=PASSWORD, first_name="A", is_verified=True)
        r = self.signup("a@example.com")
        self.assertEqual(r.status_code, 400)
        self.assertIn("email", r.data)

        r = self.client.post(
            f"{BASE}/signup/",
            {"full_name": "Bilal", "email": "b@example.com", "password": PASSWORD, "confirm_password": "nope", "accepted_terms": True},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("confirm_password", r.data)

    def test_weak_password_rejected(self):
        r = self.client.post(
            f"{BASE}/signup/",
            {"full_name": "Bilal", "email": "b@example.com", "password": "12345678", "confirm_password": "12345678", "accepted_terms": True},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_signup_requires_explicit_terms_acceptance(self):
        payload = {
            "full_name": "Bilal",
            "email": "b@example.com",
            "password": PASSWORD,
            "confirm_password": PASSWORD,
        }
        missing = self.client.post(f"{BASE}/signup/", payload, format="json")
        self.assertEqual(missing.status_code, 400)
        self.assertIn("accepted_terms", missing.data)

        payload["accepted_terms"] = False
        rejected = self.client.post(f"{BASE}/signup/", payload, format="json")
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("accepted_terms", rejected.data)

    def test_otp_locks_after_too_many_attempts(self):
        self.signup()
        code = last_code()
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(5):
            self.client.post(f"{BASE}/verify-otp/", {"email": "minhaj@example.com", "otp": wrong, "purpose": "signup"}, format="json")
        r = self.client.post(f"{BASE}/verify-otp/", {"email": "minhaj@example.com", "otp": code, "purpose": "signup"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data["code"], "locked")

    @override_settings(OTP_RESEND_SECONDS=30)
    def test_resend_cooldown(self):
        self.signup()
        r = self.client.post(f"{BASE}/resend-otp/", {"email": "minhaj@example.com", "purpose": "signup"}, format="json")
        self.assertEqual(r.status_code, 429)

    def test_forgot_and_reset_password(self):
        User.objects.create_user(email="r@example.com", password=PASSWORD, first_name="R", is_verified=True)
        r = self.client.post(f"{BASE}/forgot-password/", {"email": "r@example.com"}, format="json")
        self.assertEqual(r.status_code, 200)
        code = last_code()

        # code can be checked without being used up
        r = self.client.post(f"{BASE}/verify-otp/", {"email": "r@example.com", "otp": code, "purpose": "reset"}, format="json")
        self.assertEqual(r.status_code, 200)

        new_pw = "Brand-New-Pass-77"
        payload = {"email": "r@example.com", "otp": code, "new_password": new_pw, "confirm_password": new_pw}
        r = self.client.post(f"{BASE}/reset-password/", payload, format="json")
        self.assertEqual(r.status_code, 200)

        # the code is single use
        r = self.client.post(f"{BASE}/reset-password/", payload, format="json")
        self.assertEqual(r.status_code, 400)

        old = self.client.post(f"{BASE}/login/", {"email": "r@example.com", "password": PASSWORD}, format="json")
        self.assertEqual(old.status_code, 401)
        new = self.client.post(f"{BASE}/login/", {"email": "r@example.com", "password": new_pw}, format="json")
        self.assertEqual(new.status_code, 200)

    def test_forgot_unknown_email_sends_nothing(self):
        r = self.client.post(f"{BASE}/forgot-password/", {"email": "ghost@example.com"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    def test_change_password_and_logout(self):
        User.objects.create_user(email="c@example.com", password=PASSWORD, first_name="C", is_verified=True)
        login = self.client.post(f"{BASE}/login/", {"email": "c@example.com", "password": PASSWORD}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")

        r = self.client.post(
            f"{BASE}/change-password/",
            {"current_password": "wrong", "new_password": "Another-Pass-88", "confirm_password": "Another-Pass-88"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("current_password", r.data)

        r = self.client.post(
            f"{BASE}/change-password/",
            {"current_password": PASSWORD, "new_password": "Another-Pass-88", "confirm_password": "Another-Pass-88"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("refresh", r.data)

        # the old refresh token no longer works, the new one does
        self.client.credentials()
        old = self.client.post(f"{BASE}/token/refresh/", {"refresh": login.data["refresh"]}, format="json")
        self.assertEqual(old.status_code, 401)
        new = self.client.post(f"{BASE}/token/refresh/", {"refresh": r.data["refresh"]}, format="json")
        self.assertEqual(new.status_code, 200)

        out = self.client.post(f"{BASE}/logout/", {"refresh": new.data["refresh"]}, format="json")
        self.assertEqual(out.status_code, 205)
        again = self.client.post(f"{BASE}/token/refresh/", {"refresh": new.data["refresh"]}, format="json")
        self.assertEqual(again.status_code, 401)


@override_settings(GOOGLE_CLIENT_ID="test-client-id")
class GoogleLoginTests(APITestCase):
    URL = f"{BASE}/google/"

    def setUp(self):
        cache.clear()

    def google_login(self, **claims):
        data = {"email": "gita@example.com", "email_verified": True, "name": "Gita"}
        data.update(claims)
        with patch("account.views.google_id_token.verify_oauth2_token", return_value=data):
            return self.client.post(self.URL, {"credential": "fake-token"}, format="json")

    def test_new_google_user_is_created_and_verified(self):
        r = self.google_login()
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)
        user = User.objects.get(email="gita@example.com")
        self.assertTrue(user.is_verified)
        self.assertFalse(user.has_usable_password())
        self.assertEqual(user.full_name, "Gita")

    def test_existing_user_logs_into_same_account(self):
        User.objects.create_user(email="gita@example.com", password=PASSWORD, first_name="Gita", last_name="K", is_verified=True)
        r = self.google_login(email="Gita@Example.com")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(User.objects.filter(email="gita@example.com").count(), 1)
        self.assertEqual(r.data["user"]["full_name"], "Gita K")
        # their normal password still works
        self.assertTrue(User.objects.get(email="gita@example.com").check_password(PASSWORD))

    def test_unverified_signup_is_taken_over_by_real_owner(self):
        User.objects.create_user(email="gita@example.com", password=PASSWORD, first_name="Fake", is_verified=False)
        r = self.google_login()
        self.assertEqual(r.status_code, 200)
        user = User.objects.get(email="gita@example.com")
        self.assertTrue(user.is_verified)
        self.assertFalse(user.check_password(PASSWORD))  # the squatter's password is gone

    def test_invalid_token(self):
        with patch("account.views.google_id_token.verify_oauth2_token", side_effect=ValueError("bad token")):
            r = self.client.post(self.URL, {"credential": "junk"}, format="json")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.data["code"], "google_invalid")

    def test_google_token_verification_allows_small_clock_skew(self):
        with patch(
            "account.views.google_id_token.verify_oauth2_token",
            return_value={"email": "gita@example.com", "email_verified": True},
        ) as verify_token:
            response = self.client.post(self.URL, {"credential": "fake-token"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(verify_token.call_args.kwargs["clock_skew_in_seconds"], 10)

    def test_google_verification_transport_failure_is_retryable(self):
        with patch(
            "account.views.google_id_token.verify_oauth2_token",
            side_effect=TransportError("temporary connection failure"),
        ):
            response = self.client.post(self.URL, {"credential": "fake-token"}, format="json")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["code"], "google_verification_unavailable")

    def test_unverified_google_email_rejected(self):
        r = self.google_login(email_verified=False)
        self.assertEqual(r.status_code, 401)
        self.assertFalse(User.objects.filter(email="gita@example.com").exists())

    def test_disabled_account_rejected(self):
        User.objects.create_user(email="gita@example.com", password=PASSWORD, first_name="G", is_verified=True, is_active=False)
        self.assertEqual(self.google_login().status_code, 403)

    @override_settings(GOOGLE_CLIENT_ID="")
    def test_not_configured(self):
        r = self.client.post(self.URL, {"credential": "x"}, format="json")
        self.assertEqual(r.status_code, 503)

    def test_google_user_can_set_password_via_reset(self):
        self.google_login()
        self.client.post(f"{BASE}/forgot-password/", {"email": "gita@example.com"}, format="json")
        code = last_code()
        new_pw = "Gita-New-Pass-55"
        r = self.client.post(
            f"{BASE}/reset-password/",
            {"email": "gita@example.com", "otp": code, "new_password": new_pw, "confirm_password": new_pw},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        r = self.client.post(f"{BASE}/login/", {"email": "gita@example.com", "password": new_pw}, format="json")
        self.assertEqual(r.status_code, 200)


@override_settings(OTP_RESEND_SECONDS=0)
class ErDiagramTests(APITestCase):
    """The tables must look like the ER diagram."""

    def setUp(self):
        cache.clear()

    def test_table_and_column_names(self):
        self.assertEqual(User._meta.db_table, "user")
        self.assertEqual(PasswordOTP._meta.db_table, "password_otp")
        self.assertEqual(User._meta.get_field("password").column, "password_hash")
        user_columns = {f.column for f in User._meta.concrete_fields}
        for column in [
            "id", "first_name", "last_name", "email", "phone", "password_hash", "profile_image",
            "is_active", "is_verified", "created_at", "updated_at", "last_login",
        ]:
            self.assertIn(column, user_columns)
        otp_columns = {f.column for f in PasswordOTP._meta.concrete_fields}
        self.assertEqual(
            otp_columns,
            {"id", "otp_code", "purpose", "expires_at", "is_used", "created_at", "user_id"},
        )

    def test_column_sizes(self):
        self.assertEqual(User._meta.get_field("first_name").max_length, 50)
        self.assertEqual(User._meta.get_field("last_name").max_length, 50)
        self.assertEqual(User._meta.get_field("email").max_length, 100)
        self.assertEqual(User._meta.get_field("phone").max_length, 20)
        self.assertEqual(User._meta.get_field("password").max_length, 255)
        self.assertEqual(PasswordOTP._meta.get_field("otp_code").max_length, 10)
        self.assertEqual(PasswordOTP._meta.get_field("purpose").max_length, 50)

    def test_signup_splits_full_name(self):
        for full_name, first, last in [
            ("Minhaj", "Minhaj", ""),
            ("Minhaj Khan", "Minhaj", "Khan"),
            ("  Minhaj   Ahmed  Khan ", "Minhaj", "Ahmed Khan"),
        ]:
            email = f"{first.lower()}{len(full_name)}@example.com"
            r = self.client.post(
                f"{BASE}/signup/",
                {"full_name": full_name, "email": email, "password": PASSWORD, "confirm_password": PASSWORD, "accepted_terms": True},
                format="json",
            )
            self.assertEqual(r.status_code, 201, r.data)
            user = User.objects.get(email=email)
            self.assertEqual((user.first_name, user.last_name), (first, last))
            self.assertEqual(user.full_name, f"{first} {last}".strip())

    def test_name_too_long_is_rejected(self):
        r = self.client.post(
            f"{BASE}/signup/",
            {"full_name": "A" * 60, "email": "long@example.com", "password": PASSWORD, "confirm_password": PASSWORD, "accepted_terms": True},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("full_name", r.data)

    def test_phone_is_optional_but_unique(self):
        User.objects.create_user(email="p1@example.com", password=PASSWORD, first_name="P")
        User.objects.create_user(email="p2@example.com", password=PASSWORD, first_name="P")  # both phone=None: allowed
        User.objects.create_user(email="p3@example.com", password=PASSWORD, first_name="P", phone="9999999999")
        from django.db import IntegrityError, transaction
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create_user(email="p4@example.com", password=PASSWORD, first_name="P", phone="9999999999")

    def test_otp_code_is_not_stored_in_plain_text(self):
        self.client.post(
            f"{BASE}/signup/",
            {"full_name": "Minhaj", "email": "m@example.com", "password": PASSWORD, "confirm_password": PASSWORD, "accepted_terms": True},
            format="json",
        )
        code = last_code()
        otp = PasswordOTP.objects.get(user__email="m@example.com")
        self.assertNotEqual(otp.otp_code, code)
        self.assertLessEqual(len(otp.otp_code), 10)
        self.assertEqual(otp.purpose, "signup")
        self.assertFalse(otp.is_used)

    def test_me_returns_er_diagram_fields(self):
        User.objects.create_user(email="me@example.com", password=PASSWORD, first_name="Mina", last_name="Roy", is_verified=True)
        login = self.client.post(f"{BASE}/login/", {"email": "me@example.com", "password": PASSWORD}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        data = self.client.get(f"{BASE}/me/").data
        self.assertEqual(data["first_name"], "Mina")
        self.assertEqual(data["last_name"], "Roy")
        self.assertEqual(data["full_name"], "Mina Roy")
        self.assertIsNone(data["phone"])
        self.assertIsNone(data["profile_image"])

#started

@override_settings(REQUIRE_EMAIL_VERIFICATION=False)
class SignupWithoutVerificationTests(APITestCase):

    def setUp(self):
        cache.clear()

    def test_signup_creates_verified_account_and_sends_no_email(self):
        r = self.client.post(
            f"{BASE}/signup/",
            {
                "full_name": "Minhaj Khan",
                "email": "fast@example.com",
                "password": PASSWORD,
                "confirm_password": PASSWORD,
                "accepted_terms": True,
            },
            format="json",
        )

        self.assertEqual(r.status_code, 201)
        self.assertIs(r.data["verification_required"], False)
        self.assertEqual(len(mail.outbox), 0)

        self.assertTrue(
            User.objects.get(email="fast@example.com").is_verified
        )

        # Can log in straight away
        r = self.client.post(
            f"{BASE}/login/",
            {
                "email": "fast@example.com",
                "password": PASSWORD,
            },
            format="json",
        )

        self.assertEqual(r.status_code, 200)

    @override_settings(REQUIRE_EMAIL_VERIFICATION=True)
    def test_default_still_asks_for_a_code(self):
        r = self.client.post(
            f"{BASE}/signup/",
            {
                "full_name": "Minhaj",
                "email": "slow@example.com",
                "password": PASSWORD,
                "confirm_password": PASSWORD,
                "accepted_terms": True,
            },
            format="json",
        )

        self.assertEqual(r.status_code, 201)
        self.assertIs(r.data["verification_required"], True)
        self.assertEqual(len(mail.outbox), 1)

        self.assertFalse(
            User.objects.get(email="slow@example.com").is_verified
        )


class LastLoginTests(APITestCase):

    def setUp(self):
        cache.clear()

    def test_user_login_updates_last_login(self):
        user = User.objects.create_user(
            email="u@example.com",
            password=PASSWORD,
            first_name="U",
            is_verified=True,
        )
        self.assertIsNone(user.last_login)
        r = self.client.post(
            "/api/auth/login/",
            {
                "email": "u@example.com",
                "password": PASSWORD,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        user.refresh_from_db()
        self.assertIsNotNone(user.last_login)


class AddressDistrictTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="address@example.com",
            password=PASSWORD,
            first_name="Address",
            is_verified=True,
        )
        self.client.force_authenticate(user=self.user)

    def test_district_is_saved_and_returned(self):
        response = self.client.post(
            "/api/addresses/",
            {
                "full_name": "Address User",
                "phone": "+919876543210",
                "address_line1": "12 Main Road",
                "city": "Kochi",
                "district": "Ernakulam",
                "state": "Kerala",
                "postal_code": "682001",
                "country": "India",
                "address_type": "home",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["district"], "Ernakulam")
        self.assertEqual(
            Address.objects.get(id=response.data["id"]).district,
            "Ernakulam",
        )

    def test_address_rejects_invalid_phone_and_postal_code(self):
        body = {
            "full_name": "Address User",
            "phone": "+919876543210",
            "address_line1": "12 Main Road",
            "city": "Kochi",
            "state": "Kerala",
            "postal_code": "682001",
            "country": "India",
            "address_type": "home",
        }
        for field, value in (("phone", "abc 9876543210"), ("postal_code", "000000")):
            response = self.client.post(
                "/api/addresses/",
                {**body, field: value},
                format="json",
            )
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn(field, response.data)