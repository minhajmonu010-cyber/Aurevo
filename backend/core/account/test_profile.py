import io
import os
import shutil
import tempfile

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase

from .models import User

BASE = "/api/auth"
PASSWORD = "Sh1rt-Store-2026"


def picture(name="me.png", fmt="PNG", size=(24, 24), noise=False):
    """A real image file in memory, for upload tests."""
    img = Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3)) if noise else Image.new("RGB", size, "teal")
    buf = io.BytesIO()
    img.save(buf, fmt)
    return SimpleUploadedFile(name, buf.getvalue(), content_type=f"image/{fmt.lower()}")


class ProfileTests(APITestCase):
    URL = f"{BASE}/me/"

    def setUp(self):
        cache.clear()
        self.media = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.media)
        self.override.enable()
        self.user = User.objects.create_user(
            email="mina@example.com", password=PASSWORD, first_name="Mina", last_name="Roy", is_verified=True
        )
        self.client.force_authenticate(self.user)

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def stored(self, path):
        return os.path.exists(os.path.join(self.media, path))

    def test_needs_login(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.patch(self.URL, {"full_name": "X Y"}, format="json").status_code, 401)

    def test_me_includes_member_since(self):
        r = self.client.get(self.URL)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["created_at"])

    def test_change_name(self):
        r = self.client.patch(self.URL, {"full_name": "  Minhaj   Ahmed Khan "}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.data["first_name"], r.data["last_name"], r.data["full_name"]), ("Minhaj", "Ahmed Khan", "Minhaj Ahmed Khan"))
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "Minhaj")

    def test_only_sent_fields_change(self):
        self.client.patch(self.URL, {"phone": "9876543210"}, format="json")
        self.user.refresh_from_db()
        self.assertEqual((self.user.first_name, self.user.last_name), ("Mina", "Roy"))
        self.assertEqual(self.user.phone, "9876543210")

    def test_bad_name_is_refused(self):
        for bad in ["A", "A" * 60]:
            r = self.client.patch(self.URL, {"full_name": bad}, format="json")
            self.assertEqual(r.status_code, 400, bad)
            self.assertIn("full_name", r.data)

    def test_phone_is_cleaned_and_can_be_cleared(self):
        r = self.client.patch(self.URL, {"phone": "+91 98765-43210"}, format="json")
        self.assertEqual(r.data["phone"], "+919876543210")
        r = self.client.patch(self.URL, {"phone": ""}, format="json")
        self.assertIsNone(r.data["phone"])

    def test_bad_phone_is_refused(self):
        for bad in ["abc", "12345", "1" * 20]:
            r = self.client.patch(self.URL, {"phone": bad}, format="json")
            self.assertEqual(r.status_code, 400, bad)
            self.assertIn("phone", r.data)

    def test_phone_used_by_someone_else_is_refused_but_own_phone_is_fine(self):
        User.objects.create_user(email="other@example.com", password=PASSWORD, first_name="O", phone="9000000001")
        r = self.client.patch(self.URL, {"phone": "9000000001"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data["phone"], ["This phone number is already in use."])

        self.client.patch(self.URL, {"phone": "9111111111"}, format="json")
        self.assertEqual(self.client.patch(self.URL, {"phone": "9111111111"}, format="json").status_code, 200)

    def test_upload_replace_and_remove_picture(self):
        r = self.client.patch(self.URL, {"profile_image": picture()}, format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        first = r.data["profile_image"]
        self.assertTrue(first.startswith(f"profile_images/{self.user.pk}/") and first.endswith(".png"))
        self.assertTrue(self.stored(first))

        r = self.client.patch(self.URL, {"profile_image": picture("b.jpg", "JPEG")}, format="multipart")
        second = r.data["profile_image"]
        self.assertNotEqual(first, second)
        self.assertTrue(self.stored(second))
        self.assertFalse(self.stored(first))  # the old picture was deleted

        r = self.client.patch(self.URL, {"remove_profile_image": "true"}, format="multipart")
        self.assertIsNone(r.data["profile_image"])
        self.assertFalse(self.stored(second))

    def test_name_and_picture_in_one_save(self):
        r = self.client.patch(self.URL, {"full_name": "New Name", "phone": "9222222222", "profile_image": picture()}, format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["full_name"], r.data["phone"]), ("New Name", "9222222222"))
        self.assertTrue(r.data["profile_image"])

    def test_a_file_that_is_not_a_picture_is_refused(self):
        fake = SimpleUploadedFile("evil.png", b"this is not an image", content_type="image/png")
        r = self.client.patch(self.URL, {"profile_image": fake}, format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertIn("profile_image", r.data)
        self.assertEqual(os.listdir(self.media), [])

    def test_gif_is_not_allowed(self):
        r = self.client.patch(self.URL, {"profile_image": picture("a.gif", "GIF")}, format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertIn("profile_image", r.data)

    def test_picture_over_2mb_is_refused(self):
        big = picture("big.png", size=(1200, 1200), noise=True)
        self.assertGreater(big.size, 2 * 1024 * 1024)
        r = self.client.patch(self.URL, {"profile_image": big}, format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertIn("2 MB", r.data["profile_image"][0])

    def test_a_google_picture_url_is_replaced_but_never_deleted_as_a_file(self):
        self.user.profile_image = "https://lh3.googleusercontent.com/abc"
        self.user.save()
        r = self.client.patch(self.URL, {"profile_image": picture()}, format="multipart")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["profile_image"].startswith("profile_images/"))