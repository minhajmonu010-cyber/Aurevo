from rest_framework import serializers
from .models import Address
import re


class AddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = Address
        fields = [
            "id",
            "full_name",
            "phone",
            "address_line1",
            "address_line2",
            "city",
            "district",
            "state",
            "postal_code",
            "country",
            "address_type",
            "is_default",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_phone(self, value):
        value = value.strip()
        cleaned = re.sub(r"[\s\-()]", "", value)
        if not re.fullmatch(r"\+?[0-9]{10,15}", cleaned):
            raise serializers.ValidationError(
                "Enter a valid phone number."
            )
        return cleaned

    def validate_postal_code(self, value):
        value = value.strip().upper()
        country = self.initial_data.get("country", getattr(self.instance, "country", "India"))
        if not value:
            raise serializers.ValidationError("Postal code is required.")
        if country == "India" and not re.fullmatch(r"[1-9]\d{5}", value):
            raise serializers.ValidationError("Enter a valid 6-digit postal code.")
        if not re.fullmatch(r"[A-Z0-9](?:[A-Z0-9 -]{0,10}[A-Z0-9])", value) or not re.search(r"\d", value):
            raise serializers.ValidationError("Enter a valid postal code.")
        return value

    def validate_full_name(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Full name is required.")
        return value

    def validate_address_line1(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Address is required.")
        return value

    def validate_city(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("City is required.")
        return value

    def validate_state(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("State is required.")
        return value

    def validate_address_line2(self, value):
        return value.strip()

    def validate_district(self, value):
        return value.strip()

    def validate_country(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Country is required.")
        return value