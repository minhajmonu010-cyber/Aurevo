from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator
from django.utils import timezone


class Coupon(models.Model):
    PERCENTAGE = "percentage"
    FIXED = "fixed"

    DISCOUNT_CHOICES = [
        (PERCENTAGE, "Percentage"),
        (FIXED, "Fixed amount"),
    ]

    code = models.CharField(max_length=50, unique=True)
    description = models.CharField(max_length=255, blank=True)

    discount_type = models.CharField(
        max_length=20,
        choices=DISCOUNT_CHOICES,
        default=PERCENTAGE,
    )

    discount_value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(0.01)],
    )

    minimum_order_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
    )

    usage_limit = models.PositiveIntegerField(
        null=True,
        blank=True,
    )

    used_count = models.PositiveIntegerField(default=0)

    start_date = models.DateTimeField()
    end_date = models.DateTimeField()

    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.code

    @property
    def is_expired(self):
        return timezone.now() > self.end_date

    @property
    def is_valid_now(self):
        now = timezone.now()

        return (
            self.is_active
            and self.start_date <= now <= self.end_date
            and (
                self.usage_limit is None
                or self.used_count < self.usage_limit
            )
        )
class Offer(models.Model):
    PERCENTAGE = "percentage"
    FIXED = "fixed"

    DISCOUNT_CHOICES = [
        (PERCENTAGE, "Percentage"),
        (FIXED, "Fixed Amount"),
    ]

    ALL = "all"
    PRODUCTS = "products"
    CATEGORIES = "categories"

    TARGET_CHOICES = [
        (ALL, "All Products"),
        (PRODUCTS, "Selected Products"),
        (CATEGORIES, "Selected Categories"),
    ]

    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)

    discount_type = models.CharField(
        max_length=20,
        choices=DISCOUNT_CHOICES,
        default=PERCENTAGE,
    )
    discount_value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(0.01)],
    )

    applies_to = models.CharField(
        max_length=20,
        choices=TARGET_CHOICES,
        default=ALL,
    )

    # IDs of products/categories selected for this offer.
    target_ids = models.JSONField(default=list, blank=True)

    start_date = models.DateTimeField()
    end_date = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name

    @property
    def status(self):
        now = timezone.now()

        if not self.is_active:
            return "Inactive"
        if now < self.start_date:
            return "Scheduled"
        if now > self.end_date:
            return "Expired"
        return "Active"