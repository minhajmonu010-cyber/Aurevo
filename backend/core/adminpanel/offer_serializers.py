from decimal import Decimal

from rest_framework import serializers
from catalog.models import Category, Product
from core.validation import StrictDecimalField

from .models import Offer


class AdminOfferSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    discount_value = StrictDecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))

    class Meta:
        model = Offer
        fields = [
            "id",
            "name",
            "description",
            "discount_type",
            "discount_value",
            "applies_to",
            "target_ids",
            "start_date",
            "end_date",
            "is_active",
            "status",
            "created_at",
        ]
        read_only_fields = ["id", "status", "created_at"]

    def validate_name(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Offer name is required.")
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
        applies_to = attrs.get(
            "applies_to",
            getattr(self.instance, "applies_to", "all"),
        )
        target_ids = attrs.get(
            "target_ids",
            getattr(self.instance, "target_ids", []),
        )
        start_date = attrs.get(
            "start_date",
            getattr(self.instance, "start_date", None),
        )
        end_date = attrs.get(
            "end_date",
            getattr(self.instance, "end_date", None),
        )

        if (
            start_date and end_date
            and end_date <= start_date
        ):
            raise serializers.ValidationError({
                "end_date": "End date must be after start date."
            })

        if discount_value is not None:
            if discount_type == "percentage" and discount_value > 100:
                raise serializers.ValidationError({
                    "discount_value": "Percentage cannot exceed 100."
                })
            if discount_value <= 0:
                raise serializers.ValidationError({
                    "discount_value": "Discount must be greater than zero."
                })

        if applies_to == "all":
            attrs["target_ids"] = []
        elif not isinstance(target_ids, list) or not target_ids:
            raise serializers.ValidationError({
                "target_ids": "Select at least one product or category."
            })
        elif any(
            not isinstance(item, int) or isinstance(item, bool) or item <= 0
            for item in target_ids
        ):
            raise serializers.ValidationError({
                "target_ids": "Target IDs must be positive integers."
            })
        elif len(target_ids) != len(set(target_ids)):
            raise serializers.ValidationError({
                "target_ids": "Choose each product or category only once."
            })
        else:
            target_model = Product if applies_to == Offer.PRODUCTS else Category
            available_ids = target_model.objects.filter(
                pk__in=target_ids,
                **({"is_system": False} if target_model is Category else {}),
            ).values_list("pk", flat=True)
            if set(target_ids) != set(available_ids):
                raise serializers.ValidationError({
                    "target_ids": "Choose existing products or categories."
                })

        return attrs

    def get_status(self, obj):
        return obj.status