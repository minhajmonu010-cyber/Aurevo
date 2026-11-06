from rest_framework import serializers
from adminpanel.models import Offer

from .models import Category, Product, Review
from .offer_pricing import offer_prices


def file_url(request, field):
    """A full address for an uploaded picture, or None."""
    if not field:
        return None
    return request.build_absolute_uri(field.url) if request else field.url


def discount_percent(price, original_price):
    if original_price and original_price > price:
        return round((1 - price / original_price) * 100)
    return 0


class CategorySerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()
    product_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Category
        fields = (
            "id",
            "name",
            "slug",
            "description",
            "image",
            "is_featured",
            "in_search_suggest",
            "product_count",
        )

    def get_image(self, obj):
        return file_url(self.context.get("request"), obj.image)


class PublicOfferSerializer(serializers.ModelSerializer):
    target_names = serializers.SerializerMethodField()
    target_slugs = serializers.SerializerMethodField()

    class Meta:
        model = Offer
        fields = (
            "id", "name", "description", "discount_type", "discount_value",
            "applies_to", "target_ids", "target_names", "target_slugs",
            "start_date", "end_date",
        )

    def get_target_names(self, obj):
        target_names = self.context.get("target_names", {})
        return target_names.get(obj.pk, [])

    def get_target_slugs(self, obj):
        target_slugs = self.context.get("target_slugs", {})
        return target_slugs.get(obj.pk, [])


class CategoryBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ("id", "name", "slug")


class ProductListSerializer(serializers.ModelSerializer):
    """A product card. Needs the queryset from catalog.views.visible_products (it prefetches active_variants)."""

    category = CategoryBriefSerializer(read_only=True)
    brand = serializers.SerializerMethodField()
    image = serializers.SerializerMethodField()
    price = serializers.SerializerMethodField()
    original_price = serializers.SerializerMethodField()
    discount_percent = serializers.SerializerMethodField()
    in_stock = serializers.SerializerMethodField()
    average_rating = serializers.FloatField(read_only=True, allow_null=True)
    review_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Product
        fields = (
            "id", "name", "slug", "category", "brand", "image",
            "price", "original_price", "discount_percent", "in_stock", "is_featured",
            "average_rating", "review_count",
        )

    def _cheapest(self, obj):
        return obj.active_variants[0] if obj.active_variants else None  # prefetched, cheapest first

    def get_brand(self, obj):
        return obj.brand.name if obj.brand else None

    def get_image(self, obj):
        images = list(obj.images.all())  # main picture first (see ProductImage ordering)
        return file_url(self.context.get("request"), images[0].image) if images else None

    def get_price(self, obj):
        return f"{self._cheapest(obj).price:.2f}"

    def get_original_price(self, obj):
        original = self._cheapest(obj).original_price
        return f"{original:.2f}" if original else None

    def get_discount_percent(self, obj):
        cheapest = self._cheapest(obj)
        return discount_percent(cheapest.price, cheapest.original_price)

    def get_in_stock(self, obj):
        return any(variant.stock > 0 for variant in obj.active_variants)


class ProductDetailSerializer(ProductListSerializer):
    images = serializers.SerializerMethodField()
    variants = serializers.SerializerMethodField()

    class Meta(ProductListSerializer.Meta):
        fields = ProductListSerializer.Meta.fields + (
            "description",
            "sku",
            "collection",
            "images",
            "variants",
        )

    def get_images(self, obj):
        request = self.context.get("request")
        return [
            {"id": image.id, "image": file_url(request, image.image), "is_primary": image.is_primary}
            for image in obj.images.all()
        ]

    def get_variants(self, obj):
        pricing_by_variant = offer_prices(obj.active_variants)
        return [
            {
                "id": variant.id,
                "sku": variant.sku,
                "size": variant.size,
                "color": variant.color,
                "price": f"{variant.price:.2f}",
                "original_price": f"{variant.original_price:.2f}" if variant.original_price else None,
                "discount_percent": discount_percent(variant.price, variant.original_price),
                "offer_price": f"{pricing_by_variant[variant.id]['price']:.2f}",
                "offer_discount": f"{pricing_by_variant[variant.id]['discount']:.2f}",
                "offer_name": pricing_by_variant[variant.id]["name"],
                "stock": variant.stock,
                "in_stock": variant.stock > 0,
            }
            for variant in obj.active_variants
        ]


class PublicReviewSerializer(serializers.ModelSerializer):
    customer_name = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = ("id", "customer_name", "rating", "comment", "created_at")

    def get_customer_name(self, obj):
        return obj.user.get_full_name() or "Verified customer"
