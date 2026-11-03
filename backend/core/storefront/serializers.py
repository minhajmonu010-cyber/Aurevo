from rest_framework import serializers

from core.validation import StrictIntegerField


class CartItemWriteSerializer(serializers.Serializer):
    variant_id = StrictIntegerField(min_value=1)
    quantity = StrictIntegerField(min_value=1, max_value=1_000_000, required=False, default=1)


class CartQuantitySerializer(serializers.Serializer):
    quantity = StrictIntegerField(min_value=1, max_value=1_000_000)


class WishlistItemWriteSerializer(serializers.Serializer):
    product_id = StrictIntegerField(min_value=1)
