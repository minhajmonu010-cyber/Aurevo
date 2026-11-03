from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from account.models import User
from adminpanel.models import Offer
from catalog.models import Category, Product


class AdminOfferValidationTests(APITestCase):
    def setUp(self):
        admin = User.objects.create_user(
            email="offers-admin@example.com",
            password=None,
            first_name="Offers",
            is_staff=True,
        )
        self.client.force_authenticate(admin)
        self.category = Category.objects.create(name="Offer validation")
        self.product = Product.objects.create(name="Offer validation product", category=self.category)

    def payload(self, **overrides):
        start = timezone.now()
        return {
            "name": "Summer offer",
            "description": "Seasonal promotion",
            "discount_type": "percentage",
            "discount_value": "20.00",
            "applies_to": "all",
            "target_ids": [],
            "start_date": start.isoformat(),
            "end_date": (start + timedelta(days=7)).isoformat(),
            "is_active": True,
            **overrides,
        }

    def submit(self, **overrides):
        return self.client.post(
            "/api/admin/auth/offers/",
            self.payload(**overrides),
            format="json",
        )

    def test_create_rejects_invalid_name_discount_and_dates(self):
        invalid_payloads = [
            {"name": "   "},
            {"discount_value": "0"},
            {"discount_value": "100.01"},
            {
                "start_date": timezone.now().isoformat(),
                "end_date": (timezone.now() - timedelta(days=1)).isoformat(),
            },
        ]
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                response = self.submit(**payload)
                self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Offer.objects.exists())

    def test_selected_targets_must_be_unique_and_well_formed(self):
        duplicates = self.submit(
            applies_to="products",
            target_ids=[self.product.pk, self.product.pk],
        )
        boolean_id = self.submit(
            applies_to="products",
            target_ids=[True],
        )
        self.assertEqual(duplicates.status_code, 400, duplicates.data)
        self.assertEqual(boolean_id.status_code, 400, boolean_id.data)
        self.assertFalse(Offer.objects.exists())
