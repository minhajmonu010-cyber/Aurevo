
from django.conf import settings
from rest_framework import serializers
from catalog.models import Review

from .models import Order, OrderItem, OrderReturn, OrderStatusHistory, Payment
from .returns import calculate_item_return_refund
from core.validation import StrictIntegerField


class OrderItemSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()
    product_id = serializers.SerializerMethodField()
    reviewed = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()
    can_return = serializers.SerializerMethodField()
    return_status = serializers.SerializerMethodField()
    return_reason = serializers.SerializerMethodField()
    return_refund_amount = serializers.SerializerMethodField()

    class Meta:
        model = OrderItem
        fields = [
            "id",
            "product_id",
            "reviewed",
            "is_cancelled",
            "cancelled_at",
            "can_cancel",
            "can_return",
            "return_status",
            "return_reason",
            "return_refund_amount",
            "product_name",
            "image",
            "sku",
            "size",
            "color",
            "quantity",
            "price",
            "total_price",
        ]

    def get_image(self, obj):
        image_path = obj.product_image
        if not image_path and obj.variant_id:
            product_image = next(iter(obj.variant.product.images.all()), None)
            image_path = product_image.image.name if product_image else ""
        if not image_path:
            return None

        media_url = settings.MEDIA_URL
        if not media_url.startswith("/"):
            media_url = f"/{media_url}"
        url = f"{media_url.rstrip('/')}/{image_path.lstrip('/')}"
        request = self.context.get("request")
        return request.build_absolute_uri(url) if request else url

    def get_product_id(self, obj):
        return obj.variant.product_id if obj.variant_id else None

    def get_can_cancel(self, obj):
        order = obj.order
        if obj.is_cancelled or order.order_status not in {Order.PENDING, Order.PROCESSING}:
            return False
        prefetch_cache = getattr(order, "_prefetched_objects_cache", None)
        if prefetch_cache is None:
            order._prefetched_objects_cache = {}
            prefetch_cache = order._prefetched_objects_cache
        payments = prefetch_cache.get("payments")
        if payments is None:
            payments = list(order.payments.all())
            prefetch_cache["payments"] = payments
        return not any(
            payment.payment_status == Payment.REFUND_PENDING
            or (
                payment.payment_status == Payment.PENDING
                and payment.payment_method in {"upi", "card", "razorpay"}
            )
            for payment in payments
        )

    def get_can_return(self, obj):
        if obj.is_cancelled or obj.order.order_status != Order.DELIVERED:
            return False
        return not any(
            return_request.status in {
                OrderReturn.REQUESTED,
                OrderReturn.APPROVED,
            }
            for return_request in obj.return_requests.all()
        )

    def _latest_return_request(self, obj):
        requests = obj.return_requests.all()
        return requests[0] if requests else None

    def get_return_status(self, obj):
        return_request = self._latest_return_request(obj)
        return return_request.status if return_request else ""

    def get_return_reason(self, obj):
        return_request = self._latest_return_request(obj)
        return return_request.reason if return_request else ""

    def get_return_refund_amount(self, obj):
        return_request = self._latest_return_request(obj)
        if return_request and return_request.status != OrderReturn.REJECTED:
            return return_request.refund_amount
        return calculate_item_return_refund(obj.order, obj)

    def get_reviewed(self, obj):
        product_id = self.get_product_id(obj)
        request = self.context.get("request")
        if not product_id or not request or not request.user.is_authenticated:
            return False

        reviewed_product_ids = self.context.get("reviewed_product_ids")
        if reviewed_product_ids is None:
            reviewed_product_ids = set(
                Review.objects.filter(user=request.user).values_list("product_id", flat=True)
            )
            self.context["reviewed_product_ids"] = reviewed_product_ids
        return product_id in reviewed_product_ids


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = [
            "id",
            "payment_method",
            "amount",
            "transaction_id",
            "payment_status",
            "refunded_amount",
            "refund_id",
            "paid_at",
            "created_at",
        ]


class OrderStatusHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderStatusHistory
        fields = ["status", "updated_at"]


class CustomerReviewCreateSerializer(serializers.Serializer):
    rating = StrictIntegerField(min_value=1, max_value=5)
    comment = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    def validate_comment(self, value):
        return value.strip()


class CustomerReturnCreateSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=1000, allow_blank=False)

    def validate_reason(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Please provide a reason for the return.")
        return value


class CheckoutLineItemSerializer(serializers.Serializer):
    variant_id = StrictIntegerField(min_value=1)
    quantity = StrictIntegerField(min_value=1, max_value=1_000_000, required=False, default=1)


class CustomerCheckoutSerializer(serializers.Serializer):
    payment_method = serializers.ChoiceField(
        choices=("cash_on_delivery", "wallet", "upi", "card", "razorpay"),
        default="cash_on_delivery",
    )
    address_id = StrictIntegerField(min_value=1)
    items = CheckoutLineItemSerializer(many=True, required=False, allow_null=True, max_length=500)
    coupon_code = serializers.CharField(max_length=50, required=False, allow_blank=True, default="")

    def validate_items(self, items):
        if items is None:
            return items
        if not items:
            raise serializers.ValidationError("Select at least one product to buy.")
        variant_ids = [item["variant_id"] for item in items]
        if len(variant_ids) != len(set(variant_ids)):
            raise serializers.ValidationError("Each product variant can only appear once.")
        return items

    def validate_coupon_code(self, value):
        return value.strip()


class PaymentVerificationSerializer(serializers.Serializer):
    local_order_id = StrictIntegerField(min_value=1)
    razorpay_order_id = serializers.CharField(max_length=100)
    razorpay_payment_id = serializers.CharField(max_length=100)
    razorpay_signature = serializers.CharField(max_length=128)


class PaymentCancellationSerializer(serializers.Serializer):
    local_order_id = StrictIntegerField(min_value=1)


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    history = OrderStatusHistorySerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = [
            "id",
            "order_number",
            "total_amount",
            "discount_amount",
            "shipping_charge",
            "order_status",
            "return_reason",
            "payment_method",
            "coupon_code",
            "shipping_address",
            "tracking_id",
            "delivery_date",
            "created_at",
            "updated_at",
            "items",
            "payments",
            "history",
        ]
        read_only_fields = fields
