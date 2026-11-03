from django.conf import settings
from django.db import models
from django.db.models import Q
from django.core.validators import MaxValueValidator, MinValueValidator
from .utils import unique_slug


class Category(models.Model):
    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=100, unique=True, blank=True)  # made from the name when left empty
    description = models.TextField(blank=True)
    image = models.ImageField(upload_to="categories/", max_length=255, blank=True)  # VARCHAR(255): the file path
    # ADDED for the admin screens
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children")
    priority = models.PositiveIntegerField(default=0)  # display order: a lower number comes first
    is_active = models.BooleanField(default=True)  # False = "Blocked": hidden from shoppers
    is_featured = models.BooleanField(default=False)  # shown on the home page
    in_search_suggest = models.BooleanField(default=True)  # offered in search suggestions
    members_only = models.BooleanField(default=False)  # early access for members (stored for later)
    is_system = models.BooleanField(default=False)  # the built-in "Uncategorized Archive"
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    ARCHIVE_SLUG = "uncategorized"

    class Meta:
        db_table = "category"
        verbose_name_plural = "categories"
        ordering = ["priority", "name"]

    @classmethod
    def archive(cls):
        """Where the products of a deleted category go. Created the first time it is needed."""
        category, _ = cls.objects.get_or_create(
            slug=cls.ARCHIVE_SLUG,
            defaults={"name": "Uncategorized Archive", "is_active": False, "is_system": True, "priority": 9999},
        )
        return category

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = unique_slug(Category, self.name, 100, self.pk)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Brand(models.Model):
    name = models.CharField(max_length=100, unique=True)  # ADDED: unique
    logo = models.ImageField(upload_to="brands/", max_length=255, blank=True)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "brand"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Product(models.Model):
    # a product may have no brand; deleting a brand keeps its products
    brand = models.ForeignKey(Brand, null=True, blank=True, on_delete=models.SET_NULL, related_name="products")
    # a category with products cannot be deleted
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    slug = models.SlugField(max_length=150, unique=True, blank=True)  # the product's address in the shop
    # ADDED for the admin screens
    sku = models.CharField(max_length=60, unique=True, null=True, blank=True)  # product code / barcode; variant SKUs start with it
    collection = models.CharField(max_length=100, blank=True)  # drop / season, e.g. "Drop 04 - Cyber Acid"
    cost_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)  # unit cost (COGS)
    low_stock_threshold = models.PositiveIntegerField(default=10)  # alert when a variant has this many or fewer left
    meta_title = models.CharField(max_length=70, blank=True)  # search engine preview
    meta_description = models.CharField(max_length=160, blank=True)
    is_active = models.BooleanField(default=True)  # False = hidden from shoppers
    is_featured = models.BooleanField(default=False)  # ADDED: shown first under "Trending Products"
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "product"
        ordering = ["-created_at", "-id"]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = unique_slug(Product, self.name, 150, self.pk)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class ProductVariant(models.Model):
    """One size + colour of a product. This is what is priced, stocked, carted and ordered."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="variants")
    size = models.CharField(max_length=20)
    color = models.CharField(max_length=50)
    sku = models.CharField(max_length=100, unique=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    original_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)  # ADDED: for "-25%"
    stock = models.PositiveIntegerField(default=0)  # changed only through inventory_log entries
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "product_variant"
        ordering = ["id"]
        constraints = [  # ADDED
            models.UniqueConstraint(fields=["product", "size", "color"], name="one_variant_per_size_and_color"),
        ]

    def __str__(self):
        return f"{self.product.name} / {self.size} / {self.color}"


class ProductImage(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to="products/", max_length=255)  # VARCHAR(255): the file path
    is_primary = models.BooleanField(default=False)  # the main picture on cards
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "product_image"
        ordering = ["-is_primary", "id"]
        constraints = [  # the database itself allows only one main picture per product
            models.UniqueConstraint(
                fields=["product"], condition=Q(is_primary=True), name="one_primary_image_per_product"
            ),
        ]


class InventoryLog(models.Model):
    """Every stock change: IN = stock added, OUT = stock removed. Together they explain product_variant.stock."""

    IN = "IN"
    OUT = "OUT"
    TYPES = [(IN, "In"), (OUT, "Out")]

    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name="logs")
    type = models.CharField(max_length=3, choices=TYPES)  # an ENUM in the diagram
    quantity = models.PositiveIntegerField()
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "inventory_log"
        ordering = ["-created_at", "-id"]


class Review(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reviews",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="reviews",
    )
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)],
    )
    comment = models.TextField(blank=True)
    is_approved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(rating__gte=1, rating__lte=5),
                name="review_rating_between_1_and_5",
            ),
            models.UniqueConstraint(
                fields=["user", "product"],
                name="one_review_per_customer_product",
            ),
        ]

    def __str__(self):
        return f"{self.user} - {self.product} ({self.rating}/5)"