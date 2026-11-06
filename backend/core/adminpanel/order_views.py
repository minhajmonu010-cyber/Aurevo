import logging
from decimal import Decimal, InvalidOperation

import requests
from django.conf import settings
from django.db import transaction
from django.db.models import Count, IntegerField, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.utils.dateparse import parse_date
from rest_framework import serializers, status
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.inventory import restore_order_stock
from orders.models import Order, OrderItem, OrderStatusHistory, Payment
from wallet.models import Wallet, WalletTransaction

logger = logging.getLogger(__name__)


class AdminOrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ("id", "product_name", "sku", "size", "color", "quantity", "price", "total_price")


class AdminPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = (
            "id", "payment_method", "amount", "transaction_id", "payment_status",
            "refunded_amount", "pending_refund_amount", "refund_id", "paid_at", "created_at",
        )


class AdminOrderHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderStatusHistory
        fields = ("status", "updated_at")


class AdminOrderSerializer(serializers.ModelSerializer):
    customer_name = serializers.SerializerMethodField()
    customer_email = serializers.SerializerMethodField()
    payment_status = serializers.SerializerMethodField()
    item_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Order
        fields = (
            "id", "order_number", "customer_name", "customer_email", "order_status",
            "payment_status", "item_count", "total_amount", "discount_amount",
            "shipping_charge", "payment_method", "tracking_id", "delivery_date", "created_at",
        )

    def get_customer_name(self, obj):
        user = obj.user
        if not user:
            return "Guest customer"
        return user.get_full_name().strip() or user.email

    def get_customer_email(self, obj):
        return obj.user.email if obj.user else ""

    def get_payment_status(self, obj):
        return obj.payment_status or Payment.PENDING


class AdminOrderDetailSerializer(AdminOrderSerializer):
    items = AdminOrderItemSerializer(many=True, read_only=True)
    payments = AdminPaymentSerializer(many=True, read_only=True)
    history = AdminOrderHistorySerializer(many=True, read_only=True)

    class Meta(AdminOrderSerializer.Meta):
        fields = AdminOrderSerializer.Meta.fields + (
            "shipping_address", "return_reason", "items", "payments", "history", "updated_at",
        )


class AdminOrderUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Order.STATUSES, required=False)
    tracking_id = serializers.CharField(max_length=100, required=False, allow_blank=True)
    delivery_date = serializers.DateField(required=False, allow_null=True)
    refund_to_wallet = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Provide at least one order update.")
        if attrs.get("refund_to_wallet") and attrs.get("status") != Order.CANCELLED:
            raise serializers.ValidationError({
                "refund_to_wallet": "A wallet refund is only available when cancelling an order.",
            })
        return attrs


def _orders_with_latest_payment():
    latest_payment = Payment.objects.filter(order=OuterRef("pk")).order_by("-created_at", "-id")
    return (
        Order.objects.select_related("user")
        .annotate(
            payment_status=Subquery(latest_payment.values("payment_status")[:1]),
            item_count=Coalesce(Sum("items__quantity"), 0, output_field=IntegerField()),
        )
        .order_by("-created_at", "-id")
    )


def _parse_filter_date(value, field):
    if not value:
        return None, None
    try:
        parsed = parse_date(value)
    except ValueError:
        parsed = None
    if parsed is None:
        return None, Response({"detail": f"Invalid {field} date. Use YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST)
    return parsed, None


class AdminOrderListView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        orders = _orders_with_latest_payment()
        params = request.query_params
        search = params.get("search", "").strip().lstrip("#")
        order_status = params.get("status", "").strip()
        payment_status = params.get("payment", "").strip()

        if search:
            orders = orders.filter(
                Q(order_number__icontains=search)
                | Q(user__email__icontains=search)
                | Q(user__first_name__icontains=search)
                | Q(user__last_name__icontains=search)
            )
        if order_status:
            if order_status not in dict(Order.STATUSES):
                return Response({"detail": "Invalid order status."}, status=status.HTTP_400_BAD_REQUEST)
            orders = orders.filter(order_status=order_status)
        if payment_status:
            if payment_status not in dict(Payment.STATUSES):
                return Response({"detail": "Invalid payment status."}, status=status.HTTP_400_BAD_REQUEST)
            orders = orders.filter(payment_status=payment_status)

        start_date, error = _parse_filter_date(params.get("start"), "start")
        if error:
            return error
        end_date, error = _parse_filter_date(params.get("end"), "end")
        if error:
            return error
        if start_date and end_date and start_date > end_date:
            return Response({"detail": "Start date must be before or equal to end date."}, status=status.HTTP_400_BAD_REQUEST)
        if start_date:
            orders = orders.filter(created_at__date__gte=start_date)
        if end_date:
            orders = orders.filter(created_at__date__lte=end_date)

        sort = params.get("sort", "newest")
        sort_fields = {
            "newest": ("-created_at", "-id"),
            "oldest": ("created_at", "id"),
            "amount_desc": ("-total_amount", "-id"),
            "amount_asc": ("total_amount", "id"),
        }
        if sort not in sort_fields:
            return Response({"detail": "Invalid sort order."}, status=status.HTTP_400_BAD_REQUEST)
        orders = orders.order_by(*sort_fields[sort])

        try:
            page = max(1, int(params.get("page", 1)))
            page_size = min(100, max(1, int(params.get("page_size", 20))))
        except (TypeError, ValueError):
            return Response({"detail": "Page and page size must be whole numbers."}, status=status.HTTP_400_BAD_REQUEST)

        summary = Order.objects.aggregate(
            total=Count("id"),
            revenue=Sum("total_amount"),
        )
        by_status = dict(
            Order.objects.values("order_status").annotate(count=Count("id")).values_list("order_status", "count")
        )
        count = orders.count()
        results = orders[(page - 1) * page_size:page * page_size]
        return Response({
            "count": count,
            "page": page,
            "page_size": page_size,
            "summary": {
                "total": summary["total"] or 0,
                "revenue": summary["revenue"] or 0,
                "pending": by_status.get(Order.PENDING, 0),
                "processing": by_status.get(Order.PROCESSING, 0),
                "shipped": by_status.get(Order.SHIPPED, 0),
            },
            "results": AdminOrderSerializer(results, many=True).data,
        })


class AdminOrderDetailView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request, order_id):
        try:
            order = (
                _orders_with_latest_payment()
                .prefetch_related("items", "payments", "history")
                .get(pk=order_id)
            )
        except Order.DoesNotExist:
            return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(AdminOrderDetailSerializer(order).data)


class AdminOrderStatusView(APIView):
    permission_classes = [IsAdminUser]

    @transaction.atomic
    def patch(self, request, order_id):
        try:
            order = Order.objects.select_for_update().get(pk=order_id)
        except Order.DoesNotExist:
            return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = AdminOrderUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        update_fields = []
        refund = None

        new_status = data.get("status")
        if (
            new_status
            and order.order_status in (Order.CANCELLED, Order.RETURNED)
            and new_status != order.order_status
        ):
            return Response(
                {"detail": "Cancelled and returned orders cannot be reopened or changed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if new_status and new_status != order.order_status:
            if new_status == Order.CANCELLED:
                if data.get("refund_to_wallet"):
                    if not order.user_id:
                        return Response(
                            {"detail": "A guest order cannot be refunded to a customer wallet."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    paid_payments = list(
                        Payment.objects.select_for_update()
                        .filter(order=order, payment_status=Payment.PAID)
                        .order_by("-created_at", "-id")
                    )
                    if len(paid_payments) != 1:
                        return Response(
                            {"detail": "A wallet refund requires exactly one successful payment."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    payment = paid_payments[0]
                    refund_amount = order.total_amount
                    if (
                        refund_amount <= 0
                        or refund_amount > payment.amount - payment.refunded_amount
                    ):
                        return Response(
                            {"detail": "The remaining paid amount is insufficient for this refund."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    wallet, _ = Wallet.objects.get_or_create(user=order.user)
                    wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
                    wallet.balance += refund_amount
                    wallet.save(update_fields=["balance", "updated_at"])
                    WalletTransaction.objects.create(
                        wallet=wallet,
                        transaction_type=WalletTransaction.CREDIT,
                        amount=refund_amount,
                        description=f"Admin refund for cancelled order {order.order_number}",
                        reference=f"order:{order.order_number}:admin-cancellation",
                    )
                    payment.refunded_amount += refund_amount
                    if payment.refunded_amount >= payment.amount:
                        payment.refunded_amount = payment.amount
                        payment.payment_status = Payment.REFUNDED
                    payment.pending_refund_amount = Decimal("0.00")
                    payment.save(update_fields=[
                        "refunded_amount", "pending_refund_amount", "payment_status",
                    ])
                    refund = {"amount": str(refund_amount), "method": "wallet"}

                restore_order_stock(
                    order,
                    note=f"Cancelled by admin: order {order.order_number}",
                )
            order.order_status = new_status
            update_fields.append("order_status")
            OrderStatusHistory.objects.create(order=order, status=new_status)
        if "tracking_id" in data:
            order.tracking_id = data["tracking_id"].strip()
            update_fields.append("tracking_id")
        if "delivery_date" in data:
            order.delivery_date = data["delivery_date"]
            update_fields.append("delivery_date")

        if update_fields:
            update_fields.append("updated_at")
            order.save(update_fields=update_fields)

        order = _orders_with_latest_payment().prefetch_related("items", "payments", "history").get(pk=order.pk)
        return Response({
            "message": "Order updated successfully.",
            "order": AdminOrderDetailSerializer(order).data,
            "refund": refund,
        })


class AdminOrderRefundStatusView(APIView):
    permission_classes = [IsAdminUser]

    @transaction.atomic
    def post(self, request, order_id):
        order = Order.objects.select_for_update().filter(pk=order_id).first()
        if not order:
            return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

        payment = (
            Payment.objects.select_for_update()
            .filter(order=order, payment_status=Payment.REFUND_PENDING)
            .order_by("-created_at", "-id")
            .first()
        )
        if (
            not payment
            or not payment.refund_id
            or payment.payment_method not in {"upi", "card", "razorpay"}
        ):
            return Response(
                {"detail": "There is no pending Razorpay refund to check."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not settings.RAZORPAY_KEY_ID or not settings.RAZORPAY_KEY_SECRET:
            return Response(
                {"detail": "Razorpay credentials are not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            response = requests.get(
                f"https://api.razorpay.com/v1/refunds/{payment.refund_id}",
                auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
                timeout=15,
            )
            response.raise_for_status()
            refund = response.json()
        except (requests.RequestException, ValueError):
            logger.exception(
                "Could not check Razorpay refund %s for order %s",
                payment.refund_id,
                order.order_number,
            )
            return Response(
                {"detail": "Razorpay refund status could not be checked. Please try again."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        if not isinstance(refund, dict) or refund.get("id") != payment.refund_id:
            return Response(
                {"detail": "Razorpay returned an invalid refund record."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        provider_status = refund.get("status")
        try:
            refund_amount = Decimal(str(refund["amount"])) / Decimal("100")
        except (KeyError, InvalidOperation, ValueError):
            return Response(
                {"detail": "Razorpay returned an invalid refund amount."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        if (
            provider_status not in {"processed", "failed", "pending"}
            or refund_amount <= 0
            or refund_amount > payment.refunded_amount
            or refund_amount > payment.amount
            or (
                payment.pending_refund_amount > 0
                and refund_amount != payment.pending_refund_amount
            )
        ):
            return Response(
                {"detail": "Razorpay returned an unsupported refund status or amount."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        if provider_status == "failed":
            payment.refunded_amount = max(
                Decimal("0.00"),
                payment.refunded_amount - refund_amount,
            )
            payment.pending_refund_amount = Decimal("0.00")
            payment.payment_status = (
                Payment.REFUNDED
                if payment.refunded_amount >= payment.amount
                else Payment.PAID
            )
        elif provider_status == "processed":
            payment.pending_refund_amount = Decimal("0.00")
            payment.payment_status = (
                Payment.REFUNDED
                if payment.refunded_amount >= payment.amount
                else Payment.PAID
            )
        else:
            payment.pending_refund_amount = refund_amount

        payment.save(update_fields=[
            "refunded_amount", "pending_refund_amount", "payment_status",
        ])
        return Response({
            "message": f"Razorpay reports the refund is {provider_status}.",
            "provider_status": provider_status,
            "payment": AdminPaymentSerializer(payment).data,
        })


class AdminOrderWalletRefundView(APIView):
    permission_classes = [IsAdminUser]

    @transaction.atomic
    def post(self, request, order_id):
        order = Order.objects.select_for_update().filter(pk=order_id).first()
        if not order:
            return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)
        if order.order_status != Order.CANCELLED:
            return Response(
                {"detail": "A wallet refund is only available for cancelled orders."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not order.user_id:
            return Response(
                {"detail": "A guest order cannot be refunded to a customer wallet."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payments = list(
            Payment.objects.select_for_update()
            .filter(order=order)
            .order_by("-created_at", "-id")
        )
        if len(payments) != 1:
            return Response(
                {"detail": "A wallet refund requires exactly one payment record."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        payment = payments[0]
        if payment.payment_status not in {Payment.PAID, Payment.REFUND_PENDING}:
            return Response(
                {"detail": "This payment is not eligible for a wallet refund."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        refund_amount = (
            payment.amount
            - payment.refunded_amount
            + payment.pending_refund_amount
        )
        if refund_amount <= 0:
            return Response(
                {"detail": "There is no remaining paid amount to refund."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        wallet, _ = Wallet.objects.get_or_create(user=order.user)
        wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
        wallet.balance += refund_amount
        wallet.save(update_fields=["balance", "updated_at"])
        WalletTransaction.objects.create(
            wallet=wallet,
            transaction_type=WalletTransaction.CREDIT,
            amount=refund_amount,
            description=f"Admin refund for cancelled order {order.order_number}",
            reference=f"order:{order.order_number}:admin-cancellation",
        )
        payment.refunded_amount = payment.amount
        payment.pending_refund_amount = Decimal("0.00")
        payment.payment_status = Payment.REFUNDED
        payment.save(update_fields=[
            "refunded_amount", "pending_refund_amount", "payment_status",
        ])

        return Response({
            "message": "The remaining refund was credited to the customer's wallet.",
            "refund": {"amount": str(refund_amount), "method": "wallet"},
            "order": AdminOrderDetailSerializer(
                _orders_with_latest_payment()
                .prefetch_related("items", "payments", "history")
                .get(pk=order.pk)
            ).data,
        })
