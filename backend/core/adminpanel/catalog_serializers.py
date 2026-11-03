from decimal import Decimal

from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Max
from django.utils.text import slugify
from rest_framework import serializers

from catalog.models import Brand, Category, InventoryLog, Product, ProductImage, ProductVariant
from catalog.validators import check_image
from core.validation import StrictDecimalField, StrictIntegerField, StrictPrimaryKeyRelatedField


def _delete_old_file(old_name, instance_field):
    """After a picture was replaced or removed, delete the old file (but never the new one)."""
    if old_name and old_name != (instance_field.name if instance_field else ""):
        default_storage.delete(old_name)


class CategoryReorderSerializer(serializers.Serializer):
    order = serializers.ListField(
        child=StrictIntegerField(min_value=1),
        allow_empty=False,
        max_length=10_000,
    )

    def validate_order(self, ids):
        raw_ids = self.initial_data.get("order")
        if not isinstance(raw_ids, list) or any(
            not isinstance(category_id, int) or isinstance(category_id, bool)
            for category_id in raw_ids
        ):
            raise serializers.ValidationError("Send a list of integer category ids.")
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Send each category id only once.")
        return ids


class AdminCategorySerializer(serializers.ModelSerializer):
    product_count = serializers.SerializerMethodField()
    share = serializers.SerializerMethodField()
    parent_name = serializers.SerializerMethodField()
    remove_image = serializers.BooleanField(write_only=True, required=False, default=False)
    parent = StrictPrimaryKeyRelatedField(queryset=Category.objects.all(), required=False, allow_null=True)
    priority = StrictIntegerField(min_value=0, max_value=9998, required=False)

    class Meta:
        model = Category
        fields = (
            "id", "name", "slug", "description", "image", "remove_image", "parent", "parent_name", "priority",
            "is_active", "is_featured", "in_search_suggest", "members_only", "is_system",
            "product_count", "share", "created_at", "updated_at",
        )
        read_only_fields = ("is_system", "created_at", "updated_at")

    def get_product_count(self, obj):
        count = getattr(obj, "product_count", None)  # the list view counts them in one query
        return count if count is not None else obj.products.count()

    def get_share(self, obj):
        return self.context.get("shares", {}).get(obj.pk, 0)

    def get_parent_name(self, obj):
        return obj.parent.name if obj.parent else None

    def validate_name(self, value):
        value = " ".join(value.split())
        taken = Category.objects.filter(name__iexact=value)
        if self.instance:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("A category with this name already exists.")
        return value

    def validate_image(self, value):
        return check_image(value)

    def validate_parent(self, value):
        if value is None:
            return None
        if value.is_system:
            raise serializers.ValidationError("The archive cannot be a parent category.")
        if self.instance:
            node = value
            while node is not None:  # walk up: the new parent must not be this category or one of its children
                if node.pk == self.instance.pk:
                    raise serializers.ValidationError("A category cannot sit under itself.")
                node = node.parent
        return value

    @transaction.atomic
    def create(self, validated_data):
        validated_data.pop("remove_image", None)
        if "priority" not in validated_data:  # the next free place in the list
            highest = Category.objects.filter(is_system=False).aggregate(top=Max("priority"))["top"] or 0
            validated_data["priority"] = highest + 1
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if instance.is_system:
            raise serializers.ValidationError({"detail": "The archive category can't be edited."})
        remove = validated_data.pop("remove_image", False)
        old = instance.image.name if instance.image else ""
        if remove and not validated_data.get("image"):
            validated_data["image"] = ""
        instance = super().update(instance, validated_data)
        _delete_old_file(old, instance.image)
        return instance


class AdminBrandSerializer(serializers.ModelSerializer):
    product_count = serializers.IntegerField(read_only=True)
    remove_logo = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = Brand
        fields = ("id", "name", "logo", "remove_logo", "description", "product_count", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")

    def validate_name(self, value):
        value = " ".join(value.split())
        existing = Brand.objects.filter(name__iexact=value)
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError("A brand with this name already exists.")
        return value

    def validate_logo(self, value):
        return check_image(value)

    def create(self, validated_data):
        validated_data.pop("remove_logo", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        remove = validated_data.pop("remove_logo", False)
        old = instance.logo.name if instance.logo else ""
        if remove and not validated_data.get("logo"):
            validated_data["logo"] = ""
        instance = super().update(instance, validated_data)
        _delete_old_file(old, instance.logo)
        return instance


class AdminVariantSerializer(serializers.ModelSerializer):
    # stock can be set once, when the variant is created. After that use the stock endpoint, so every change is logged.
    stock = StrictIntegerField(min_value=0, max_value=1_000_000, required=False, default=0)
    price = StrictDecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    original_price = StrictDecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)

    class Meta:
        model = ProductVariant
        fields = ("id", "product", "size", "color", "sku", "price", "original_price", "stock", "is_active", "created_at", "updated_at")
        read_only_fields = ("product", "created_at", "updated_at")

    def validate(self, attrs):
        current = self.instance
        price = attrs.get("price", getattr(current, "price", None))
        original = attrs.get("original_price", getattr(current, "original_price", None))
        if price is not None and price <= 0:
            raise serializers.ValidationError({"price": "The price must be more than 0."})
        if original is not None and price is not None and original <= price:
            raise serializers.ValidationError({"original_price": "The old price must be higher than the price."})

        product = self.context.get("product") or getattr(current, "product", None)
        size = attrs.get("size", getattr(current, "size", None))
        color = attrs.get("color", getattr(current, "color", None))
        if product and size is not None and color is not None:
            clash = ProductVariant.objects.filter(product=product, size__iexact=size, color__iexact=color)
            if current:
                clash = clash.exclude(pk=current.pk)
            if clash.exists():
                raise serializers.ValidationError("This product already has a variant with this size and colour.")

        if current is not None and "stock" in attrs and attrs["stock"] != current.stock:
            raise serializers.ValidationError({"stock": "Use the stock endpoint (add or remove stock) to change the stock."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        variant = super().create(validated_data)
        if variant.stock > 0:
            InventoryLog.objects.create(variant=variant, type=InventoryLog.IN, quantity=variant.stock, note="Initial stock")
        return variant

    def update(self, instance, validated_data):
        validated_data.pop("stock", None)
        return super().update(instance, validated_data)


class StockAdjustSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=[InventoryLog.IN, InventoryLog.OUT])
    quantity = StrictIntegerField(min_value=1, max_value=100_000)
    note = serializers.CharField(required=False, allow_blank=True, max_length=500)


class InventoryLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryLog
        fields = ("id", "type", "quantity", "note", "created_at")


class AdminImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductImage
        fields = ("id", "product", "image", "is_primary", "created_at")
        read_only_fields = ("product", "created_at")

    def validate_image(self, value):
        return check_image(value)

    def update(self, instance, validated_data):
        validated_data.pop("image", None)  # a picture is replaced by uploading a new one and deleting the old
        return super().update(instance, validated_data)


def make_variant_sku(product, size, color, taken):
    """OFT-TEE-043 + M + Black -> OFT-TEE-043-M-BLACK (-2, -3... if that exists already)."""
    base = product.sku or slugify(product.name)[:20].upper() or "SKU"
    code = slugify(f"{size}-{color}").upper() or "VARIANT"
    sku, number = f"{base}-{code}"[:100], 2
    while sku in taken or ProductVariant.objects.filter(sku=sku).exists():
        sku = f"{base}-{code}-{number}"[:100]
        number += 1
    return sku


def stock_status(product):
    """'none' (no variants yet), 'out' (all sold out), 'low' (a variant is at or under the alert level), else 'ok'."""
    variants = [v for v in product.variants.all() if v.is_active]
    if not variants:
        return "none"
    if sum(v.stock for v in variants) == 0:
        return "out"
    return "low" if any(v.stock <= product.low_stock_threshold for v in variants) else "ok"


class NewVariantSerializer(serializers.Serializer):
    """One size + colour created together with a new product (the Add Product form)."""

    size = serializers.CharField(max_length=20)
    color = serializers.CharField(max_length=50)
    price = StrictDecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    original_price = StrictDecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    stock = StrictIntegerField(min_value=0, max_value=1_000_000, default=0)
    sku = serializers.CharField(max_length=100, required=False, allow_blank=True)

    def validate(self, attrs):
        original = attrs.get("original_price")
        if original is not None and original <= attrs["price"]:
            raise serializers.ValidationError({"original_price": "The old price must be higher than the price."})
        return attrs


class AdminProductListSerializer(serializers.ModelSerializer):
    """One row in the admin product table."""

    category = serializers.SerializerMethodField()
    brand = serializers.SerializerMethodField()
    image = serializers.SerializerMethodField()
    min_price = serializers.SerializerMethodField()
    max_price = serializers.SerializerMethodField()
    total_stock = serializers.SerializerMethodField()
    variant_count = serializers.SerializerMethodField()
    stock_status = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = (
            "id", "name", "slug", "sku", "collection", "category", "brand", "image", "min_price", "max_price",
            "total_stock", "variant_count", "stock_status", "low_stock_threshold", "is_active", "is_featured", "created_at",
        )

    def get_category(self, obj):
        return {"id": obj.category_id, "name": obj.category.name}

    def get_brand(self, obj):
        return {"id": obj.brand_id, "name": obj.brand.name} if obj.brand else None

    def get_image(self, obj):
        images = list(obj.images.all())
        request = self.context.get("request")
        if not images:
            return None
        return request.build_absolute_uri(images[0].image.url) if request else images[0].image.url

    def _prices(self, obj):
        return [variant.price for variant in obj.variants.all()]

    def get_min_price(self, obj):
        prices = self._prices(obj)
        return f"{min(prices):.2f}" if prices else None

    def get_max_price(self, obj):
        prices = self._prices(obj)
        return f"{max(prices):.2f}" if prices else None

    def get_total_stock(self, obj):
        return sum(variant.stock for variant in obj.variants.all())

    def get_variant_count(self, obj):
        return len(obj.variants.all())

    def get_stock_status(self, obj):
        return stock_status(obj)


class AdminProductSerializer(serializers.ModelSerializer):
    """Create, edit and view one product (with its variants and pictures)."""

    category = StrictPrimaryKeyRelatedField(queryset=Category.objects.filter(is_system=False))
    brand = StrictPrimaryKeyRelatedField(queryset=Brand.objects.all(), allow_null=True, required=False)
    sku = serializers.CharField(max_length=60, required=False, allow_blank=True, allow_null=True)
    cost_price = StrictDecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False, allow_null=True)
    low_stock_threshold = StrictIntegerField(min_value=0, max_value=2_147_483_647, required=False, default=10)
    category_name = serializers.SerializerMethodField()
    brand_name = serializers.SerializerMethodField()
    total_stock = serializers.SerializerMethodField()
    stock_status = serializers.SerializerMethodField()
    variants = AdminVariantSerializer(many=True, read_only=True)
    images = AdminImageSerializer(many=True, read_only=True)
    new_variants = NewVariantSerializer(many=True, write_only=True, required=False, max_length=100)  # only used when creating

    class Meta:
        model = Product
        fields = (
            "id", "name", "slug", "sku", "description", "collection", "category", "category_name", "brand", "brand_name",
            "cost_price", "low_stock_threshold", "meta_title", "meta_description",
            "is_active", "is_featured", "total_stock", "stock_status", "variants", "images", "new_variants",
            "created_at", "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_category_name(self, obj):
        return obj.category.name

    def get_brand_name(self, obj):
        return obj.brand.name if obj.brand else None

    def get_total_stock(self, obj):
        return sum(variant.stock for variant in obj.variants.all())

    def get_stock_status(self, obj):
        return stock_status(obj)

    def validate_name(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Enter the product name.")
        return value

    def validate_sku(self, value):
        value = (value or "").strip().upper()
        if not value:
            return None  # an empty box means "no product code"
        taken = Product.objects.filter(sku__iexact=value)
        if self.instance:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("Another product already uses this SKU.")
        return value

    def validate_cost_price(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("The cost cannot be negative.")
        return value

    def validate_new_variants(self, items):
        seen_pairs, seen_skus = set(), set()
        for item in items:
            pair = (item["size"].strip().lower(), item["color"].strip().lower())
            if pair in seen_pairs:
                raise serializers.ValidationError(f"Size {item['size']} in {item['color']} is listed twice.")
            seen_pairs.add(pair)
            sku = (item.get("sku") or "").strip().upper()
            if sku:
                if sku in seen_skus or ProductVariant.objects.filter(sku=sku).exists():
                    raise serializers.ValidationError(f"The SKU {sku} is already used.")
                seen_skus.add(sku)
        return items

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("new_variants", [])
        product = super().create(validated_data)
        used = set()
        for item in items:
            sku = (item.get("sku") or "").strip().upper() or make_variant_sku(product, item["size"], item["color"], used)
            used.add(sku)
            variant = ProductVariant.objects.create(
                product=product, size=item["size"].strip(), color=item["color"].strip(), sku=sku,
                price=item["price"], original_price=item.get("original_price"), stock=item.get("stock", 0),
            )
            if variant.stock > 0:
                InventoryLog.objects.create(variant=variant, type=InventoryLog.IN, quantity=variant.stock, note="Initial stock")
        return product

    def update(self, instance, validated_data):
        validated_data.pop("new_variants", None)  # variants of an existing product are managed one by one
        return super().update(instance, validated_data)