from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
import re
from core.validation import StrictBooleanField
from .models import PasswordOTP
from .utils import split_full_name

User=get_user_model()

class EmailField(serializers.EmailField):
    def __init__(self,**kwargs):
        kwargs.setdefault('max_length', 100)
        super().__init__(**kwargs)

    def to_internal_value(self,data):
        return super().to_internal_value(data).strip().lower()

MAX_IMAGE_BYTES = 2 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def check_full_name(value):
    """One name box in the form, two VARCHAR(50) columns in the table."""
    first, last = split_full_name(value)
    if len(first) > 50 or len(last) > 50:
        raise serializers.ValidationError("First and last name can be at most 50 characters each.")
    return " ".join(value.split())

class UserSerializer(serializers.ModelSerializer):
    full_name=serializers.ReadOnlyField()

    class Meta:
        model=User
        fields=("id", "email", "first_name", "last_name","full_name", "phone", "profile_image", "is_verified", "is_staff","created_at")
        read_only_fields=fields

class PasswordInputSerializer(serializers.Serializer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name, field in self.fields.items():
            if "password" in name:
                field.trim_whitespace = False
                field.max_length = 1024


class SignupSerializer(PasswordInputSerializer):
    full_name=serializers.CharField(min_length=2, max_length=101)
    email=EmailField()
    accepted_terms=StrictBooleanField(write_only=True)
    password=serializers.CharField(write_only=True)
    confirm_password=serializers.CharField(write_only=True)

    def validate_full_name(self,value):
        value = " ".join(value.split())
        first,last=split_full_name(value)
        if len(value) < 2:
            raise serializers.ValidationError("Enter your full name.")
        if len(first)>50 or len(last)>50:
            raise serializers.ValidationError("First and last name can be at most 50 characters each.")
        return value

    def validate(self,attrs):
        if not attrs["accepted_terms"]:
            raise serializers.ValidationError(
                {"accepted_terms":"You must accept the Terms of Service and Privacy Policy."}
            )
        if attrs['password'] !=attrs['confirm_password']:
            raise serializers.ValidationError({"confirm_password":"Password do not match"})
        try:
            validate_password(attrs['password'])
        except DjangoValidationError as err:
            raise serializers.ValidationError({"password": err.messages}) from err
        return attrs

class LoginSerializer(PasswordInputSerializer):
    email=EmailField()
    password=serializers.CharField(write_only=True)

class GoogleLoginSerializer(serializers.Serializer):
    credential=serializers.CharField()

class RefreshTokenSerializer(serializers.Serializer):
    refresh = serializers.CharField(min_length=20, max_length=4096, trim_whitespace=True)

class EmailOnlySerializer(serializers.Serializer):
    email=EmailField()

class OTPPurposeSerializer(serializers.Serializer):
    email=EmailField()
    purpose=serializers.ChoiceField(choices=[PasswordOTP.SIGNUP,PasswordOTP.RESET])

class VerifyOTPSerializer(OTPPurposeSerializer):
    otp=serializers.RegexField(r"^\d{6}$",error_messages={"invalid":"Enter the 6-digit code."})

class ResetPasswordSerializer(PasswordInputSerializer):
    email=EmailField()
    otp=serializers.RegexField(r"^\d{6}$",error_messages={"invalid":"Enter the 6-digit code."})
    new_password=serializers.CharField(write_only=True)
    confirm_password=serializers.CharField(write_only=True)

    def validate(self, attrs):
        if attrs['new_password'] !=attrs['confirm_password']:
            raise serializers.ValidationError({"confirm_password":"Password do not match."})
        return attrs

class ChangePasswordSerializer(PasswordInputSerializer):
    current_password=serializers.CharField(write_only=True)
    new_password=serializers.CharField(write_only=True)
    confirm_password=serializers.CharField(write_only=True)

    def validate(self, attrs):
        if attrs['new_password'] !=attrs['confirm_password']:
            raise serializers.ValidationError({"confirm_password":"Passwords do not match."})
        return attrs
#here
class ProfileUpdateSerializer(serializers.Serializer):
    """Edit Profile form. Every field is optional: only what is sent is changed."""

    full_name = serializers.CharField(min_length=2, max_length=101, required=False)
    phone = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=30)
    profile_image = serializers.ImageField(required=False, allow_null=True)  # needs Pillow
    remove_profile_image = serializers.BooleanField(required=False, default=False)

    def validate_full_name(self, value):
        return check_full_name(value)

    def validate_phone(self, value):
        if not value:
            return None  # an empty box clears the phone number
        cleaned = re.sub(r"[\s\-()]", "", value)
        if not re.fullmatch(r"\+?[0-9]{7,15}", cleaned):
            raise serializers.ValidationError("Enter a valid phone number (7 to 15 digits).")
        return cleaned

    def validate_profile_image(self, value):
        if value is None:
            return None
        if value.size > MAX_IMAGE_BYTES:
            raise serializers.ValidationError("The picture must be 2 MB or smaller.")
        # value.content_type was set from what Pillow really found in the file, not from the browser
        if value.content_type not in ALLOWED_IMAGE_TYPES:
            raise serializers.ValidationError("Use a JPG, PNG or WebP picture.")
        return value