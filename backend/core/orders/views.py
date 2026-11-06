from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import hmac
import logging
import uuid

import requests
from django.conf import settings
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from account.models import Address
from adminpanel.models import Coupon
from catalog.inventory import restore_order_stock
from catalog.models import InventoryLog, ProductVariant, Review
from catalog.offer_pricing import offer_prices
from storefront.models import CartItem
from wallet.models import Wallet, WalletTransaction

from .models import Order, OrderItem, OrderReturn, OrderStatusHistory, Payment
from .returns import calculate_item_return_refund
from .serializers import (
    CustomerCheckoutSerializer,
    CustomerReturnCreateSerializer,
    CustomerReviewCreateSerializer,
    OrderSerializer,
    PaymentCancellationSerializer,
    PaymentVerificationSerializer,
)

logger = logging.getLogger(__name__)


def razorpay_configured():
    return bool(settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET)


def create_razorpay_order(amount, receipt):
    response = requests.post(
        "https://api.razorpay.com/v1/orders",
        auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
        json={"amount": amount, "currency": "INR", "receipt": receipt},
        timeout=15,
    )
    response.raise_for_status()
    return response.json()


def fetch_razorpay_payment(payment_id):
    response = requests.get(
        f"https://api.razorpay.com/v1/payments/{payment_id}",
        auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
        timeout=15,
    )
    response.raise_for_status()
    return response.json()


RAZORPAY_METHODS = ("upi", "card", "razorpay")


def calculate_coupon_discount(subtotal, coupon):
    if coupon.discount_type == Coupon.PERCENTAGE:
        discount = subtotal * coupon.discount_value / Decimal("100")
        if coupon.max_discount_amount is not None:
            discount = min(discount, coupon.max_discount_amount)
    else:
        discount = min(subtotal, coupon.discount_value)
    return discount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class RefundError(Exception):
    pass


def refund_paid_amount(order, payments, amount, reference):
    amount = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if amount <= 0:
        return None

    paid_payments = [
        payment for payment in payments
        if payment.payment_status == Payment.PAID
    ]
    if not paid_payments:
        return None
    if len(paid_payments) != 1:
        raise RefundError("This order has multiple successful payments. Contact support for a refund.")

    payment = paid_payments[0]
    refundable = payment.amount - payment.refunded_amount
    if amount > refundable:
        raise RefundError("The refund amount exceeds the remaining amount paid.")

    refund_id = ""
    refund_status = "processed"
    if payment.payment_method in RAZORPAY_METHODS:
        if not payment.transaction_id or not razorpay_configured():
            raise RefundError("Online refund is unavailable. Please contact support.")
        try:
            response = requests.post(
                f"https://api.razorpay.com/v1/payments/{payment.transaction_id}/refund",
                auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
                json={
                    "amount": int(amount * 100),
                    "speed": "normal",
                    "notes": {
                        "order_number": order.order_number,
                        "cancellation": reference,
                    },
                },
                timeout=15,
            )
            response.raise_for_status()
            refund = response.json()
        except (requests.RequestException, ValueError):
            logger.exception(
                "Razorpay refund request failed for order %s",
                order.order_number,
            )
            raise RefundError("Razorpay could not process the refund. Please try again or contact support.")

        if (
            not isinstance(refund, dict)
            or refund.get("status") == "failed"
            or not refund.get("id")
        ):
            logger.error(
                "Razorpay returned an unsuccessful refund response for order %s",
                order.order_number,
            )
            raise RefundError("Razorpay could not process the refund. Please contact support.")
        refund_id = refund["id"]
        refund_status = refund.get("status", "pending")
    elif payment.payment_method == "wallet":
        wallet, _ = Wallet.objects.get_or_create(user=order.user)
        wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
        wallet.balance += amount
        wallet.save(update_fields=["balance", "updated_at"])
        WalletTransaction.objects.create(
            wallet=wallet,
            transaction_type=WalletTransaction.CREDIT,
            amount=amount,
            description=f"Refund for order {order.order_number}",
            reference=f"order:{order.order_number}:refund:{reference}",
        )
    else:
        raise RefundError("This payment method cannot be refunded automatically. Please contact support.")

    payment.refunded_amount += amount
    if payment.refunded_amount >= payment.amount and refund_status == "processed":
        payment.refunded_amount = payment.amount
        payment.payment_status = Payment.REFUNDED
    elif payment.payment_method in RAZORPAY_METHODS and refund_status != "processed":
        payment.payment_status = Payment.REFUND_PENDING
        payment.pending_refund_amount = amount
    else:
        payment.pending_refund_amount = Decimal("0.00")
    payment.refund_id = refund_id or payment.refund_id
    payment.save(update_fields=[
        "refunded_amount", "pending_refund_amount", "payment_status", "refund_id",
    ])
    return {
        "amount": str(amount),
        "method": "wallet" if payment.payment_method == "wallet" else "razorpay",
        "status": payment.payment_status,
        "refund_id": refund_id,
        "provider_status": refund_status,
    }


def release_coupon_use(order):
    if not order.coupon_id:
        return
    coupon = Coupon.objects.select_for_update().filter(pk=order.coupon_id).first()
    if coupon and coupon.used_count > 0:
        coupon.used_count -= 1
        coupon.save(update_fields=["used_count"])


class CustomerOrderListView(generics.ListAPIView):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return (
            Order.objects.filter(user=self.request.user)
            .prefetch_related(
                "items__variant__product__images",
                "items__return_requests",
                "payments",
                "history",
            )
            .order_by("-created_at", "-id")
        )


class CustomerOrderDetailView(generics.RetrieveAPIView):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = "pk"

    def get_queryset(self):
        return (
            Order.objects.filter(user=self.request.user)
            .prefetch_related(
                "items__variant__product__images",
                "items__return_requests",
                "payments",
                "history",
            )
        )


class CustomerOrderCancelView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        try:
            order = (
                Order.objects.select_for_update()
                .get(pk=pk, user=request.user)
            )
        except Order.DoesNotExist:
            return Response(
                {"detail": "Order not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if order.order_status not in {Order.PENDING, Order.PROCESSING}:
            return Response(
                {
                    "detail": (
                        "Orders can only be cancelled before they are shipped. "
                        "Please contact support for assistance."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        payments = list(
            Payment.objects.select_for_update().filter(order=order)
        )
        if any(payment.payment_status == Payment.REFUND_PENDING for payment in payments):
            return Response(
                {"detail": "A refund is still processing for this order. Try again after it completes."},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            refund = refund_paid_amount(
                order,
                payments,
                order.total_amount,
                "full-order",
            )
        except RefundError as error:
            return Response({"detail": str(error)}, status=status.HTTP_502_BAD_GATEWAY)

        restore_order_stock(
            order,
            note=f"Cancelled customer order {order.order_number}",
        )
        order.items.filter(is_cancelled=False).update(
            is_cancelled=True,
            cancelled_at=timezone.now(),
        )
        release_coupon_use(order)
        Payment.objects.filter(
            order=order,
            payment_status=Payment.PENDING,
        ).update(payment_status=Payment.FAILED)
        order.order_status = Order.CANCELLED
        order.save(update_fields=["order_status", "updated_at"])

        OrderStatusHistory.objects.create(
            order=order,
            status=Order.CANCELLED,
        )

        return Response(
            {
                "detail": "Order cancelled successfully.",
                "order": {
                    "id": order.id,
                    "order_number": order.order_number,
                    "order_status": order.order_status,
                },
                "refund": refund,
            },
            status=status.HTTP_200_OK,
        )


class CustomerOrderItemCancelView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request, order_id, item_id):
        order = (
            Order.objects.select_for_update()
            .filter(pk=order_id, user=request.user)
            .first()
        )
        if not order:
            return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

        if order.order_status not in {Order.PENDING, Order.PROCESSING}:
            return Response(
                {"detail": "Items can only be cancelled before the order is shipped."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payments = list(
            Payment.objects.select_for_update().filter(order=order)
        )
        if any(payment.payment_status == Payment.REFUND_PENDING for payment in payments):
            return Response(
                {"detail": "A refund is still processing for this order. Try again after it completes."},
                status=status.HTTP_409_CONFLICT,
            )
        if any(
            payment.payment_status == Payment.PENDING
            and payment.payment_method in RAZORPAY_METHODS
            for payment in payments
        ):
            return Response(
                {"detail": "Cancel the pending online payment before cancelling individual items."},
                status=status.HTTP_409_CONFLICT,
            )

        paid_payments = [
            payment for payment in payments
            if payment.payment_status == Payment.PAID
        ]
        if paid_payments and len(paid_payments) != 1:
            return Response(
                {"detail": "This order has multiple successful payments. Contact support for cancellation."},
                status=status.HTTP_409_CONFLICT,
            )

        item = (
            OrderItem.objects.select_for_update()
            .filter(pk=item_id, order=order)
            .first()
        )
        if not item:
            return Response({"detail": "Order item not found."}, status=status.HTTP_404_NOT_FOUND)
        if item.is_cancelled:
            return Response(
                {"detail": "This item has already been cancelled."},
                status=status.HTTP_409_CONFLICT,
            )

        active_items = list(
            order.items.filter(is_cancelled=False).values_list("total_price", flat=True)
        )
        original_subtotal = sum(active_items, Decimal("0.00"))
        remaining_subtotal = original_subtotal - item.total_price
        refund = None

        if remaining_subtotal <= 0:
            try:
                refund = refund_paid_amount(
                    order,
                    payments,
                    order.total_amount,
                    f"item-{item.pk}",
                )
            except RefundError as error:
                return Response({"detail": str(error)}, status=status.HTTP_502_BAD_GATEWAY)

            now = timezone.now()
            if item.variant_id:
                variant = ProductVariant.objects.select_for_update().filter(
                    pk=item.variant_id
                ).first()
                if variant:
                    variant.stock += item.quantity
                    variant.save(update_fields=["stock", "updated_at"])
                    InventoryLog.objects.create(
                        variant=variant,
                        type=InventoryLog.IN,
                        quantity=item.quantity,
                        note=f"Cancelled order item from {order.order_number}",
                    )
            item.is_cancelled = True
            item.cancelled_at = now
            item.save(update_fields=["is_cancelled", "cancelled_at"])
            release_coupon_use(order)
            Payment.objects.filter(
                order=order,
                payment_status=Payment.PENDING,
            ).update(payment_status=Payment.FAILED)
            order.order_status = Order.CANCELLED
            order.save(update_fields=["order_status", "updated_at"])
            OrderStatusHistory.objects.create(order=order, status=Order.CANCELLED)
        else:
            coupon = (
                Coupon.objects.select_for_update().filter(pk=order.coupon_id).first()
                if order.coupon_id
                else None
            )
            previous_coupon_discount = order.coupon_discount_amount
            if coupon and previous_coupon_discount == 0:
                previous_coupon_discount = min(
                    calculate_coupon_discount(original_subtotal, coupon),
                    order.discount_amount,
                )
            product_discount = max(
                order.discount_amount - previous_coupon_discount,
                Decimal("0.00"),
            )
            remaining_product_discount = (
                product_discount * remaining_subtotal / original_subtotal
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

            if coupon and remaining_subtotal < coupon.minimum_order_amount:
                release_coupon_use(order)
                order.coupon = None
                order.coupon_code = ""
                coupon_discount = Decimal("0.00")
            elif coupon:
                coupon_discount = calculate_coupon_discount(remaining_subtotal, coupon)
            else:
                coupon_discount = Decimal("0.00")

            new_total = remaining_subtotal - coupon_discount + order.shipping_charge
            refund_amount = max(order.total_amount - new_total, Decimal("0.00"))
            try:
                refund = refund_paid_amount(
                    order,
                    payments,
                    refund_amount,
                    f"item-{item.pk}",
                )
            except RefundError as error:
                return Response({"detail": str(error)}, status=status.HTTP_502_BAD_GATEWAY)

            now = timezone.now()
            if item.variant_id:
                variant = ProductVariant.objects.select_for_update().filter(
                    pk=item.variant_id
                ).first()
                if variant:
                    variant.stock += item.quantity
                    variant.save(update_fields=["stock", "updated_at"])
                    InventoryLog.objects.create(
                        variant=variant,
                        type=InventoryLog.IN,
                        quantity=item.quantity,
                        note=f"Cancelled order item from {order.order_number}",
                    )
            item.is_cancelled = True
            item.cancelled_at = now
            item.save(update_fields=["is_cancelled", "cancelled_at"])
            order.coupon_discount_amount = coupon_discount
            order.discount_amount = remaining_product_discount + coupon_discount
            order.total_amount = new_total
            order.save(update_fields=[
                "coupon",
                "coupon_code",
                "coupon_discount_amount",
                "discount_amount",
                "total_amount",
                "updated_at",
            ])
            Payment.objects.filter(
                order=order,
                payment_status=Payment.PENDING,
            ).update(amount=order.total_amount)

        refreshed_order = (
            Order.objects.filter(pk=order.pk)
            .prefetch_related(
                "items__variant__product__images",
                "items__return_requests",
                "payments",
                "history",
            )
            .get()
        )
        return Response({
            "detail": "Item cancelled successfully.",
            "refund": refund,
            "order": OrderSerializer(refreshed_order, context={"request": request}).data,
        })


class CustomerOrderItemReturnView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request, order_id, item_id):
        try:
            order = (
                Order.objects.select_for_update()
                .get(pk=order_id, user=request.user)
            )
        except Order.DoesNotExist:
            return Response(
                {"detail": "Order not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = CustomerReturnCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = serializer.validated_data["reason"]

        if order.order_status != Order.DELIVERED:
            return Response(
                {"detail": "Only delivered orders can be returned."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        item = (
            OrderItem.objects.select_for_update()
            .filter(pk=item_id, order=order)
            .first()
        )
        if item is None:
            return Response(
                {"detail": "Order item not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if item.is_cancelled:
            return Response(
                {"detail": "Cancelled items cannot be returned."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if item.return_requests.filter(
            status__in=(OrderReturn.REQUESTED, OrderReturn.APPROVED)
        ).exists():
            return Response(
                {"detail": "A return for this item is already requested or approved."},
                status=status.HTTP_409_CONFLICT,
            )

        refund_amount = calculate_item_return_refund(order, item)
        return_request = OrderReturn.objects.create(
            order=order,
            item=item,
            reason=reason,
            refund_amount=refund_amount,
        )

        return Response(
            {
                "detail": "Return request submitted for this item.",
                "return_id": return_request.id,
                "item_id": item.id,
                "refund_amount": return_request.refund_amount,
                "status": return_request.status,
            },
            status=status.HTTP_201_CREATED,
        )


class CustomerOrderItemReviewView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request, order_id, item_id):
        try:
            order = Order.objects.select_for_update().get(
                pk=order_id,
                user=request.user,
            )
        except Order.DoesNotExist:
            return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

        if order.order_status != Order.DELIVERED:
            return Response(
                {"detail": "You can review products after the order is delivered."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            item = OrderItem.objects.select_related("variant__product").get(
                pk=item_id,
                order=order,
            )
        except OrderItem.DoesNotExist:
            return Response({"detail": "Order item not found."}, status=status.HTTP_404_NOT_FOUND)

        if not item.variant_id:
            return Response(
                {"detail": "This product is no longer available to review."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = CustomerReviewCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        review, created = Review.objects.get_or_create(
            user=request.user,
            product=item.variant.product,
            defaults={
                **serializer.validated_data,
                "is_approved": False,
            },
        )
        if not created:
            return Response(
                {"detail": "You have already reviewed this product."},
                status=status.HTTP_409_CONFLICT,
            )

        return Response(
            {"detail": "Thank you. Your review is awaiting approval."},
            status=status.HTTP_201_CREATED,
        )


class CustomerAvailableCouponsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        try:
            subtotal = Decimal(str(request.query_params.get("subtotal", "0")))
        except (InvalidOperation, TypeError, ValueError):
            return Response({"detail": "Invalid order subtotal."}, status=status.HTTP_400_BAD_REQUEST)
        if subtotal < 0:
            return Response({"detail": "Order subtotal cannot be negative."}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        coupons = Coupon.objects.filter(
            is_active=True,
            start_date__lte=now,
            end_date__gte=now,
        ).filter(Q(usage_limit__isnull=True) | Q(used_count__lt=F("usage_limit"))).order_by("end_date", "code")

        return Response({
            "results": [
                {
                    "code": coupon.code,
                    "description": coupon.description,
                    "discount_type": coupon.discount_type,
                    "discount_value": str(coupon.discount_value),
                    "max_discount_amount": (
                        str(coupon.max_discount_amount)
                        if coupon.max_discount_amount is not None
                        else None
                    ),
                    "minimum_order_amount": str(coupon.minimum_order_amount),
                    "eligible": subtotal >= coupon.minimum_order_amount,
                    "discount_amount": str(calculate_coupon_discount(subtotal, coupon))
                    if subtotal >= coupon.minimum_order_amount
                    else "0.00",
                    "minimum_remaining": str(max(coupon.minimum_order_amount - subtotal, Decimal("0.00"))),
                    "end_date": coupon.end_date,
                }
                for coupon in coupons
            ]
        })


class CustomerCheckoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        enabled = razorpay_configured()
        return Response({
            "online_payment_enabled": enabled,
            "key_id": settings.RAZORPAY_KEY_ID if enabled else "",
        })

    @transaction.atomic
    def post(self, request):
        serializer = CustomerCheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        payment_method = data["payment_method"]
        if payment_method in RAZORPAY_METHODS and not razorpay_configured():
            return Response(
                {"detail": "Online payments are not configured yet."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        address_id = data["address_id"]
        address = Address.objects.filter(
            pk=address_id,
            user=request.user,
        ).first()
        if not address:
            return Response(
                {"address_id": ["Choose a valid delivery address."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        requested_items = data.get("items")
        cart_items = []
        quantities = {}

        if requested_items is None:
            cart_items = list(
                CartItem.objects.select_for_update()
                .filter(user=request.user)
                .order_by("id")
            )
            quantities = {item.variant_id: item.quantity for item in cart_items}
        else:
            for item in requested_items:
                quantities[item["variant_id"]] = item["quantity"]

        if not quantities:
            return Response(
                {"detail": "Your cart is empty."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        variants = list(
            ProductVariant.objects.select_for_update()
            .filter(
                pk__in=quantities,
                is_active=True,
                product__is_active=True,
                product__category__is_active=True,
            )
            .select_related("product", "product__category")
            .prefetch_related("product__images")
            .order_by("id")
        )
        variants_by_id = {variant.id: variant for variant in variants}
        if len(variants_by_id) != len(quantities):
            return Response(
                {"detail": "One or more selected products are no longer available."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        for variant_id, quantity in quantities.items():
            variant = variants_by_id[variant_id]
            if quantity > variant.stock:
                return Response(
                    {"detail": f"Only {variant.stock} of {variant.product.name} are available."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        shipping_address = {
            "full_name": address.full_name,
            "phone": address.phone,
            "address_line1": address.address_line1,
            "address_line2": address.address_line2,
            "city": address.city,
            "district": address.district,
            "state": address.state,
            "postal_code": address.postal_code,
            "country": address.country,
        }

        pricing_by_variant = offer_prices(variants)
        subtotal = sum(
            (
                pricing_by_variant[variant_id]["price"] * quantity
                for variant_id, quantity in quantities.items()
            ),
            start=Decimal("0.00"),
        )
        original_subtotal = sum(
            (
                (variants_by_id[variant_id].original_price or variants_by_id[variant_id].price)
                * quantity
                for variant_id, quantity in quantities.items()
            ),
            start=Decimal("0.00"),
        )
        coupon_code = data["coupon_code"]
        coupon = None
        coupon_discount = Decimal("0.00")
        if coupon_code:
            coupon = Coupon.objects.select_for_update().filter(code__iexact=coupon_code).first()
            if not coupon or not coupon.is_valid_now:
                return Response({"coupon_code": ["This coupon is invalid or no longer available."]}, status=status.HTTP_400_BAD_REQUEST)
            if subtotal < coupon.minimum_order_amount:
                return Response(
                    {"coupon_code": [f"This coupon requires a minimum order of ₹{coupon.minimum_order_amount}."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            coupon_discount = calculate_coupon_discount(subtotal, coupon)

        order_total = max(subtotal - coupon_discount, Decimal("0.00"))
        discount_amount = original_subtotal - subtotal + coupon_discount

        wallet = None
        if payment_method == "wallet":
            wallet, _ = Wallet.objects.get_or_create(user=request.user)
            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
            if wallet.balance < order_total:
                return Response(
                    {"detail": "Your wallet balance is not enough to pay for this order."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        gateway_order = None
        if payment_method in RAZORPAY_METHODS:
            try:
                gateway_order = create_razorpay_order(
                    int(order_total * 100),
                    f"aurevo-{uuid.uuid4().hex[:28]}",
                )
            except Exception:
                logger.exception("Razorpay order creation failed")
                return Response(
                    {"detail": "Unable to start online payment. Please try again."},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

        order = Order.objects.create(
            user=request.user,
            total_amount=order_total,
            discount_amount=discount_amount,
            coupon_discount_amount=coupon_discount,
            shipping_charge=0,
            order_status=Order.PROCESSING if wallet else Order.PENDING,
            payment_method=payment_method,
            coupon=coupon,
            coupon_code=coupon.code if coupon else "",
            shipping_address=shipping_address,
            checkout_from_cart=bool(cart_items),
        )

        order_items = []
        inventory_logs = []
        updated_at = timezone.now()
        for variant_id, quantity in quantities.items():
            variant = variants_by_id[variant_id]
            product_images = variant.product.images.all()
            product_image = next(iter(product_images), None)
            order_items.append(OrderItem(
                order=order,
                variant=variant,
                category=variant.product.category,
                product_name=variant.product.name,
                product_image=product_image.image.name if product_image else "",
                sku=variant.sku,
                size=variant.size,
                color=variant.color,
                quantity=quantity,
                price=pricing_by_variant[variant_id]["price"],
                total_price=pricing_by_variant[variant_id]["price"] * quantity,
            ))
            variant.stock -= quantity
            variant.updated_at = updated_at
            inventory_logs.append(InventoryLog(
                variant=variant,
                type=InventoryLog.OUT,
                quantity=quantity,
                note=f"Checkout reservation for order {order.order_number}",
            ))

        OrderItem.objects.bulk_create(order_items)
        ProductVariant.objects.bulk_update(variants, ["stock", "updated_at"])
        InventoryLog.objects.bulk_create(inventory_logs)

        OrderStatusHistory.objects.create(order=order, status=order.order_status)
        payment = Payment.objects.create(
            order=order,
            payment_method=payment_method,
            amount=order_total,
            payment_status=Payment.PAID if wallet else Payment.PENDING,
            gateway_order_id=gateway_order["id"] if gateway_order else "",
            paid_at=timezone.now() if wallet else None,
        )

        if coupon:
            coupon.used_count += 1
            coupon.save(update_fields=["used_count"])

        if wallet:
            wallet.balance -= order_total
            wallet.save(update_fields=["balance", "updated_at"])
            WalletTransaction.objects.create(
                wallet=wallet,
                transaction_type=WalletTransaction.DEBIT,
                amount=order_total,
                description=f"Payment for order {order.order_number}",
                reference=f"order:{order.order_number}",
            )

        if payment_method in {"cash_on_delivery", "wallet"} and cart_items:
            CartItem.objects.filter(
                user=request.user,
                id__in=[item.id for item in cart_items],
            ).delete()

        if gateway_order:
            return Response({
                "payment_required": True,
                "local_order_id": order.id,
                "payment_id": payment.id,
                "discount_amount": str(discount_amount),
                "total_amount": str(order_total),
                "coupon_code": coupon_code,
                "razorpay": {
                    "key_id": settings.RAZORPAY_KEY_ID,
                    "order_id": gateway_order["id"],
                    "amount": gateway_order["amount"],
                    "currency": gateway_order["currency"],
                },
            }, status=status.HTTP_201_CREATED)

        order = Order.objects.prefetch_related(
            "items__variant__product__images",
            "items__return_requests",
            "payments",
            "history",
        ).get(pk=order.pk)
        return Response(
            OrderSerializer(order, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class CustomerPaymentVerifyView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = PaymentVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        local_order_id = data["local_order_id"]
        provider_order_id = data["razorpay_order_id"]
        payment_id = data["razorpay_payment_id"]
        signature = data["razorpay_signature"]

        payment = Payment.objects.select_related("order").filter(
            order_id=local_order_id,
            order__user=request.user,
            gateway_order_id=provider_order_id,
            payment_method__in=RAZORPAY_METHODS,
        ).first()
        if not payment:
            return Response({"detail": "Checkout payment was not found."}, status=status.HTTP_404_NOT_FOUND)
        if payment.payment_status == Payment.PAID:
            if payment.transaction_id == payment_id:
                return Response(
                    OrderSerializer(
                        payment.order,
                        context={"request": request},
                    ).data
                )
            return Response({"detail": "This order has already been paid."}, status=status.HTTP_409_CONFLICT)

        expected_signature = hmac.new(
            settings.RAZORPAY_KEY_SECRET.encode(),
            f"{provider_order_id}|{payment_id}".encode(),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected_signature, signature):
            return Response({"detail": "Payment signature verification failed."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            provider_payment = fetch_razorpay_payment(payment_id)
        except Exception:
            logger.exception("Razorpay payment status lookup failed")
            return Response({"detail": "Unable to verify payment status."}, status=status.HTTP_502_BAD_GATEWAY)

        if (
            provider_payment.get("order_id") != provider_order_id
            or int(provider_payment.get("amount", 0)) != int(payment.amount * 100)
            or provider_payment.get("currency") != "INR"
            or provider_payment.get("status") != "captured"
        ):
            return Response({"detail": "Payment is not captured for this order."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=local_order_id, user=request.user)
            payment = Payment.objects.select_for_update().get(pk=payment.pk, order=order)
            if order.order_status != Order.PENDING:
                return Response({"detail": "This checkout is no longer pending."}, status=status.HTTP_409_CONFLICT)
            if payment.payment_status == Payment.PAID:
                return Response(
                    OrderSerializer(order, context={"request": request}).data
                )

            payment.payment_status = Payment.PAID
            payment.transaction_id = payment_id
            payment.paid_at = timezone.now()
            payment.save(update_fields=["payment_status", "transaction_id", "paid_at"])
            order.order_status = Order.PROCESSING
            order.save(update_fields=["order_status", "updated_at"])
            OrderStatusHistory.objects.create(order=order, status=Order.PROCESSING)

            if order.checkout_from_cart:
                for item in order.items.all():
                    if not item.variant_id:
                        continue
                    cart_item = CartItem.objects.select_for_update().filter(
                        user=request.user,
                        variant_id=item.variant_id,
                    ).first()
                    if cart_item:
                        if cart_item.quantity <= item.quantity:
                            cart_item.delete()
                        else:
                            cart_item.quantity -= item.quantity
                            cart_item.save(update_fields=["quantity", "updated_at"])

            return Response(
                OrderSerializer(order, context={"request": request}).data
            )


class CustomerPaymentCancelView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        serializer = PaymentCancellationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        local_order_id = serializer.validated_data["local_order_id"]

        order = Order.objects.select_for_update().filter(
            pk=local_order_id,
            user=request.user,
        ).first()
        if not order:
            return Response({"detail": "Checkout order was not found."}, status=status.HTTP_404_NOT_FOUND)

        payment = Payment.objects.select_for_update().filter(
            order=order,
            payment_method__in=RAZORPAY_METHODS,
        ).first()
        if not payment:
            return Response({"detail": "Checkout payment was not found."}, status=status.HTTP_404_NOT_FOUND)
        if payment.payment_status != Payment.PENDING:
            return Response({"detail": "This payment can no longer be cancelled."}, status=status.HTTP_409_CONFLICT)

        restore_order_stock(
            order,
            note=f"Cancelled online payment for order {order.order_number}",
        )
        release_coupon_use(order)
        payment.payment_status = Payment.FAILED
        payment.save(update_fields=["payment_status"])
        order.order_status = Order.CANCELLED
        order.save(update_fields=["order_status", "updated_at"])
        OrderStatusHistory.objects.create(order=order, status=Order.CANCELLED)
        return Response({"detail": "Payment attempt cancelled."})
