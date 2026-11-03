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


class AdminOrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ("id", "product_name", "sku", "size", "color", "quantity", "price", "total_price")


class AdminPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ("id", "payment_method", "amount", "transaction_id", "payment_status", "paid_at", "created_at")


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

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Provide at least one order update.")
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
        })
