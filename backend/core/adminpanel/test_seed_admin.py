from io import StringIO

from django.contrib.auth.hashers import check_password
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from .admin_seed import EXAMPLE_PASSWORD, ensure_admin, seed_admin_on_migrate
from account.models import User

PASSWORD = "Boss-Pass-Store-77"


class EnsureAdminTests(TestCase):
    def test_creates_a_staff_account_that_is_not_a_superuser(self):
        self.assertEqual(ensure_admin("Boss@Example.com", PASSWORD, first_name="Boss"), "created")
        user = User.objects.get(email="boss@example.com")
        self.assertTrue(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertTrue(user.is_verified)
        self.assertTrue(user.is_active)
        self.assertTrue(user.check_password(PASSWORD))
        self.assertEqual(user.first_name, "Boss")

    def test_running_it_again_changes_nothing(self):
        ensure_admin("boss@example.com", PASSWORD)
        self.assertEqual(ensure_admin("boss@example.com", PASSWORD), "unchanged")
        self.assertEqual(User.objects.count(), 1)

    def test_password_is_not_overwritten_unless_asked(self):
        ensure_admin("boss@example.com", PASSWORD)
        self.assertEqual(ensure_admin("boss@example.com", "Another-Pass-Store-88"), "unchanged")
        self.assertTrue(User.objects.get().check_password(PASSWORD))

        self.assertEqual(ensure_admin("boss@example.com", "Another-Pass-Store-88", reset_password=True), "updated")
        self.assertTrue(User.objects.get().check_password("Another-Pass-Store-88"))

    def test_a_disabled_admin_is_switched_back_on(self):
        ensure_admin("boss@example.com", PASSWORD)
        User.objects.update(is_active=False)
        self.assertEqual(ensure_admin("boss@example.com", PASSWORD), "updated")
        self.assertTrue(User.objects.get().is_active)

    def test_weak_password_is_refused(self):
        for weak in ["12345678", "short", "password"]:
            with self.assertRaises(ValidationError):
                ensure_admin("boss@example.com", weak)
        self.assertEqual(User.objects.count(), 0)

    def test_an_existing_customer_is_never_promoted_by_accident(self):
        User.objects.create_user(email="boss@example.com", password="Customers-Own-Pass-1", first_name="C", is_verified=True)
        self.assertEqual(ensure_admin("boss@example.com", PASSWORD), "blocked")
        user = User.objects.get()
        self.assertFalse(user.is_staff)
        self.assertTrue(user.check_password("Customers-Own-Pass-1"))

    def test_promote_replaces_the_customers_password(self):
        User.objects.create_user(email="boss@example.com", password="Customers-Own-Pass-1", first_name="C", is_verified=True)
        self.assertEqual(ensure_admin("boss@example.com", PASSWORD, promote=True), "updated")
        user = User.objects.get()
        self.assertTrue(user.is_staff)
        self.assertTrue(check_password(PASSWORD, user.password))
        self.assertFalse(check_password("Customers-Own-Pass-1", user.password))


class SeedAdminCommandTests(TestCase):
    def run_command(self, *args):
        out = StringIO()
        call_command("seed_admin", *args, stdout=out)
        return out.getvalue()

    @override_settings(ADMIN_EMAIL="boss@example.com", ADMIN_PASSWORD=PASSWORD, ADMIN_FIRST_NAME="Boss")
    def test_command_creates_then_reports_existing(self):
        self.assertIn("created", self.run_command())
        self.assertIn("already exists", self.run_command())
        self.assertEqual(User.objects.filter(is_staff=True).count(), 1)

    @override_settings(ADMIN_EMAIL="", ADMIN_PASSWORD="")
    def test_command_needs_the_settings(self):
        with self.assertRaises(CommandError):
            self.run_command()

    @override_settings(ADMIN_EMAIL="boss@example.com", ADMIN_PASSWORD=EXAMPLE_PASSWORD, DEBUG=False)
    def test_example_password_is_refused_on_a_live_site(self):
        with self.assertRaises(CommandError):
            self.run_command()
        self.assertEqual(User.objects.count(), 0)

    @override_settings(ADMIN_EMAIL="boss@example.com", ADMIN_PASSWORD=EXAMPLE_PASSWORD, DEBUG=True)
    def test_example_password_is_fine_while_developing(self):
        self.assertIn("created", self.run_command())

    @override_settings(ADMIN_EMAIL="boss@example.com", ADMIN_PASSWORD=PASSWORD)
    def test_blocked_customer_needs_promote(self):
        User.objects.create_user(email="boss@example.com", password="Customers-Own-Pass-1", first_name="C", is_verified=True)
        with self.assertRaises(CommandError):
            self.run_command()
        self.assertIn("updated", self.run_command("--promote"))
        self.assertTrue(User.objects.get().is_staff)


class SeedOnMigrateTests(APITestCase):
    def setUp(self):
        cache.clear()

    @override_settings(TESTING=False, ADMIN_EMAIL="boss@example.com", ADMIN_PASSWORD=PASSWORD, ADMIN_FIRST_NAME="Boss")
    def test_creates_the_admin_after_migrate_and_that_admin_can_log_in(self):
        seed_admin_on_migrate()
        seed_admin_on_migrate()  # running migrate twice must not create a second one
        self.assertEqual(User.objects.filter(email="boss@example.com").count(), 1)

        r = self.client.post("/api/admin/auth/login/", {"email": "boss@example.com", "password": PASSWORD}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["user"]["is_staff"])
        self.assertFalse(User.objects.get(email="boss@example.com").is_superuser)

    @override_settings(TESTING=False, ADMIN_EMAIL="", ADMIN_PASSWORD="")
    def test_does_nothing_when_nothing_is_configured(self):
        seed_admin_on_migrate()
        self.assertEqual(User.objects.count(), 0)

    @override_settings(TESTING=False, ADMIN_EMAIL="boss@example.com", ADMIN_PASSWORD="12345678")
    def test_weak_password_creates_nothing_and_does_not_crash_migrate(self):
        seed_admin_on_migrate()
        self.assertEqual(User.objects.count(), 0)

    @override_settings(TESTING=True, ADMIN_EMAIL="boss@example.com", ADMIN_PASSWORD=PASSWORD)
    def test_the_test_runner_never_creates_an_admin(self):
        seed_admin_on_migrate()
        self.assertEqual(User.objects.count(), 0)