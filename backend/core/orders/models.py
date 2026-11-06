from django.db import models

# Create your models here.
from django.conf import settings
from django.db import models


class Order(models.Model):
    PENDING, PROCESSING, SHIPPED, DELIVERED, CANCELLED, RETURNED = (
        "pending", "processing", "shipped", "delivered", "cancelled", "returned",
    )
    STATUSES = [
        (PENDING, "Pending"), (PROCESSING, "Processing"), (SHIPPED, "Shipped"),
        (DELIVERED, "Delivered"), (CANCELLED, "Cancelled"), (RETURNED, "Returned"),
    ]
    PREFIX = "AV"

    order_number = models.CharField(max_length=20, unique=True, blank=True)  # ADDED: AV-00012
    # the order stays when a customer account is deleted
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="orders")
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    coupon_discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    shipping_charge = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    order_status = models.CharField(max_length=50, choices=STATUSES, default=PENDING)
    return_reason = models.TextField(blank=True, default="")
    payment_method = models.CharField(max_length=50, blank=True)
    coupon = models.ForeignKey("adminpanel.Coupon", null=True, blank=True, on_delete=models.SET_NULL, related_name="orders")
    coupon_code = models.CharField(max_length=50, blank=True, default="")
    shipping_address = models.JSONField(default=dict, blank=True)
    checkout_from_cart = models.BooleanField(default=False)
    tracking_id = models.CharField(max_length=100, blank=True)
    delivery_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "orders"
        ordering = ["-created_at", "-id"]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.order_number:
            self.order_number = f"{self.PREFIX}-{self.pk:05d}"
            super().save(update_fields=["order_number"])

    def __str__(self):
        return self.order_number


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    # deleting a product keeps the order line (history is preserved)
    variant = models.ForeignKey("catalog.ProductVariant", null=True, on_delete=models.SET_NULL, related_name="order_items")
    category = models.ForeignKey("catalog.Category", null=True, on_delete=models.SET_NULL, related_name="order_items")  # ADDED
    product_name = models.CharField(max_length=160)  # ADDED: copies, see the note at the top
    product_image = models.CharField(max_length=255, blank=True, default="")
    sku = models.CharField(max_length=100, blank=True)
    size = models.CharField(max_length=20, blank=True)
    color = models.CharField(max_length=50, blank=True)
    quantity = models.PositiveIntegerField()
    price = models.DecimalField(max_digits=10, decimal_places=2)  # price of one unit when it was bought
    total_price = models.DecimalField(max_digits=10, decimal_places=2)
    is_cancelled = models.BooleanField(default=False)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "order_item"
        ordering = ["id"]


class Payment(models.Model):
    PENDING, PAID, FAILED, REFUND_PENDING, REFUNDED = (
        "pending", "paid", "failed", "refund_pending", "refunded",
    )
    STATUSES = [
        (PENDING, "Pending"),
        (PAID, "Paid"),
        (FAILED, "Failed"),
        (REFUND_PENDING, "Refund pending"),
        (REFUNDED, "Refunded"),
    ]

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="payments")  # one order can have several attempts
    payment_method = models.CharField(max_length=50, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    gateway_order_id = models.CharField(max_length=50, blank=True, default="")
    transaction_id = models.CharField(max_length=100, unique=True, null=True, blank=True)
    payment_status = models.CharField(max_length=50, choices=STATUSES, default=PENDING)
    refunded_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    pending_refund_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    refund_id = models.CharField(max_length=100, blank=True, default="")
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payment"
        ordering = ["-created_at", "-id"]


class OrderStatusHistory(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="history")
    status = models.CharField(max_length=50, choices=Order.STATUSES)
    updated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "order_status_history"
        ordering = ["updated_at", "id"]
        verbose_name_plural = "order status history"


class OrderReturn(models.Model):
    REQUESTED, APPROVED, REJECTED = "requested", "approved", "rejected"
    STATUSES = [
        (REQUESTED, "Requested"),
        (APPROVED, "Approved"),
        (REJECTED, "Rejected"),
    ]

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="return_requests")
    item = models.ForeignKey(
        OrderItem,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="return_requests",
    )
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=STATUSES, default=REQUESTED)
    refund_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"Return for {self.order.order_number} ({self.status})"