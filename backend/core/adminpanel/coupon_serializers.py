from decimal import Decimal

from rest_framework import serializers
from core.validation import StrictDecimalField, StrictIntegerField
from .models import Coupon


class AdminCouponSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    discount_value = StrictDecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    max_discount_amount = StrictDecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal("0.01"),
        allow_null=True,
        required=False,
    )
    minimum_order_amount = StrictDecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal("0"),
        required=False,
        default=Decimal("0"),
    )
    usage_limit = StrictIntegerField(min_value=1, max_value=2_147_483_647, allow_null=True, required=False)

    class Meta:
        model = Coupon
        fields = [
            "id",
            "code",
            "description",
            "discount_type",
            "discount_value",
            "max_discount_amount",
            "minimum_order_amount",
            "usage_limit",
            "used_count",
            "start_date",
            "end_date",
            "is_active",
            "status",
            "created_at",
        ]
        read_only_fields = ["id", "used_count", "created_at"]

    def validate_code(self, value):
        value = value.strip().upper()
        if not value:
            raise serializers.ValidationError("Coupon code is required.")

        queryset = Coupon.objects.filter(code__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)

        if queryset.exists():
            raise serializers.ValidationError(
                "A coupon with this code already exists."
            )

        return value

    def validate_usage_limit(self, value):
        if value is not None and value < 1:
            raise serializers.ValidationError("Usage limit must be a positive whole number.")
        if self.instance and value is not None and value < self.instance.used_count:
            raise serializers.ValidationError("Usage limit cannot be lower than the number of times this coupon was used.")
        return value

    def validate(self, attrs):
        discount_type = attrs.get(
            "discount_type",
            getattr(self.instance, "discount_type", None),
        )
        discount_value = attrs.get(
            "discount_value",
            getattr(self.instance, "discount_value", None),
        )
        max_discount_amount = attrs.get(
            "max_discount_amount",
            getattr(self.instance, "max_discount_amount", None),
        )
        start_date = attrs.get(
            "start_date",
            getattr(self.instance, "start_date", None),
        )
        end_date = attrs.get(
            "end_date",
            getattr(self.instance, "end_date", None),
        )

        if start_date and end_date and end_date <= start_date:
            raise serializers.ValidationError({
                "end_date": "End date must be after start date."
            })

        if discount_type == "percentage" and discount_value is not None:
            if discount_value > 100:
                raise serializers.ValidationError({
                    "discount_value": "Percentage cannot exceed 100."
                })
        elif max_discount_amount is not None:
            raise serializers.ValidationError({
                "max_discount_amount": "Maximum discount amount is only available for percentage coupons."
            })

        return attrs

    def get_status(self, obj):
        from django.utils import timezone

        now = timezone.now()

        if not obj.is_active:
            return "Inactive"
        if now < obj.start_date:
            return "Scheduled"
        if now > obj.end_date:
            return "Expired"
        if (
            obj.usage_limit is not None
            and obj.used_count >= obj.usage_limit
        ):
            return "Used up"

        return "Active"