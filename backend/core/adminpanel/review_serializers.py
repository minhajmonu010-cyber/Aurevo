from rest_framework import serializers
from catalog.models import Review
from core.validation import StrictBooleanField


class AdminReviewApprovalSerializer(serializers.Serializer):
    is_approved = StrictBooleanField()


class AdminReviewSerializer(serializers.ModelSerializer):
    customer_name = serializers.SerializerMethodField()
    product_name = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = [
            "id",
            "customer_name",
            "product_name",
            "rating",
            "comment",
            "is_approved",
            "created_at",
        ]

    def get_customer_name(self, obj):
        user = obj.user
        return user.get_full_name() or user.email

    def get_product_name(self, obj):
        return str(obj.product)