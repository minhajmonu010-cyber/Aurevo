from django.contrib.auth import get_user_model
from rest_framework import serializers
import re
from core.validation import StrictBooleanField


class AdminPasswordSerializer(serializers.Serializer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if "password" in self.fields:
            self.fields["password"].trim_whitespace = False
            self.fields["password"].max_length = 1024


class AdminLoginSerializer(AdminPasswordSerializer):
    email = serializers.EmailField(max_length=100)
    password = serializers.CharField(write_only=True)

    def validate_email(self, value):
        return value.strip().lower()


class AdminRefreshTokenSerializer(serializers.Serializer):
    refresh = serializers.CharField(min_length=20, max_length=4096, trim_whitespace=True)


class AdminCustomerStatusSerializer(serializers.Serializer):
    is_active = StrictBooleanField()

    def validate(self, attrs):
        if set(self.initial_data) != {"is_active"}:
            raise serializers.ValidationError("Provide only an is_active boolean value.")
        return attrs


class AdminUserSerializer(serializers.ModelSerializer):
    full_name = serializers.ReadOnlyField()

    class Meta:
        model = get_user_model()
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "full_name",
            "phone",
            "is_staff",
            "is_verified",
            "created_at",
        )
        read_only_fields = ("id", "email", "full_name", "is_staff", "is_verified", "created_at")

    def validate_first_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("First name cannot be blank.")
        return value

    def validate_last_name(self, value):
        return value.strip()

    def validate_phone(self, value):
        if value is None or value == "":
            return None
        value = value.strip()
        cleaned = re.sub(r"[\s\-()]", "", value)
        if not re.fullmatch(r"\+?[0-9]{7,15}", cleaned):
            raise serializers.ValidationError("Enter a valid phone number (7 to 15 digits).")
        if value and get_user_model().objects.exclude(pk=self.instance.pk).filter(phone=value).exists():
            raise serializers.ValidationError("This phone number is already in use.")
        if cleaned and get_user_model().objects.exclude(pk=self.instance.pk).filter(phone=cleaned).exists():
            raise serializers.ValidationError("This phone number is already in use.")
        return cleaned