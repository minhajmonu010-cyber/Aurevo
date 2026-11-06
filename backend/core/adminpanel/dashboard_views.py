from decimal import Decimal

from django.db.models import Count, IntegerField, OuterRef, Prefetch, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils.dateparse import parse_date
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from orders.models import Order, OrderItem, Payment

from .analytics import dashboard_summary
from .dashboard_serializers import DashboardOrderSerializer


class DashboardView(APIView):
    """GET /api/admin/dashboard/?range=7d|30d|12m"""

    permission_classes = [IsAdminUser]

    def get(self, request):
        range_key = request.query_params.get("range", "7d")
        if range_key not in ("7d", "30d", "12m"):
            range_key = "7d"
        return Response(dashboard_summary(range_key))


class OrdersPagination(PageNumberPagination):
    page_size = 5
    page_size_query_param = "page_size"
    max_page_size = 1000  # the CSV export asks for many at once


class DashboardOrdersView(ListAPIView):
    """GET /api/admin/dashboard/orders/?search=&status=&payment=&page=&page_size=   (newest first)"""

    permission_classes = [IsAdminUser]
    serializer_class = DashboardOrderSerializer
    pagination_class = OrdersPagination

    def get_queryset(self):
        params = self.request.query_params
        latest_payment = Payment.objects.filter(order=OuterRef("pk")).order_by("-created_at", "-id").values("payment_status")[:1]
        item_count = (
            OrderItem.objects.filter(order_id=OuterRef("pk"))
            .values("order_id")
            .annotate(total=Sum("quantity"))
            .values("total")[:1]
        )
        queryset = Order.objects.select_related("user").annotate(
            latest_payment_status=Subquery(latest_payment),
            items_count=Coalesce(Subquery(item_count, output_field=IntegerField()), Value(0)),
        )

        search = params.get("search", "").strip().lstrip("#")
        if search:
            queryset = queryset.filter(
                Q(order_number__icontains=search)
                | Q(user__email__icontains=search)
                | Q(user__first_name__icontains=search)
                | Q(user__last_name__icontains=search)
            )
        start = params.get("start", "").strip()
        end = params.get("end", "").strip()
        try:
            start_date = parse_date(start) if start else None
            end_date = parse_date(end) if end else None
        except ValueError as error:
            raise ValidationError({"detail": "Invalid date. Use YYYY-MM-DD."}) from error
        if start and not start_date:
            raise ValidationError({"detail": "Invalid start date. Use YYYY-MM-DD."})
        if end and not end_date:
            raise ValidationError({"detail": "Invalid end date. Use YYYY-MM-DD."})
        if start_date and end_date and start_date > end_date:
            raise ValidationError({"detail": "Start date must be before or equal to end date."})
        if start_date:
            queryset = queryset.filter(created_at__date__gte=start_date)
        if end_date:
            queryset = queryset.filter(created_at__date__lte=end_date)
        if params.get("status") in dict(Order.STATUSES):
            queryset = queryset.filter(order_status=params["status"])
        if params.get("payment") in dict(Payment.STATUSES):
            queryset = queryset.filter(latest_payment_status=params["payment"])
        return queryset.order_by("-created_at", "-id")

class SalesReportView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        from datetime import timedelta
        from django.db.models.functions import TruncDate
        from django.utils import timezone

        today = timezone.localdate()

        try:
            end_date = today.fromisoformat(
                request.query_params.get("end", str(today))
            )
            start_date = today.fromisoformat(
                request.query_params.get(
                    "start",
                    str(today - timedelta(days=29)),
                )
            )
        except ValueError:
            return Response(
                {"detail": "Invalid date. Use YYYY-MM-DD."},
                status=400,
            )

        if start_date > end_date:
            return Response(
                {"detail": "Start date must be before end date."},
                status=400,
            )

        if (end_date - start_date).days > 365:
            return Response(
                {"detail": "Maximum date range is 366 days."},
                status=400,
            )

        payments = Payment.objects.filter(
            payment_status=Payment.PAID,
            paid_at__date__gte=start_date,
            paid_at__date__lte=end_date,
        )

        totals = payments.aggregate(
            total_sales=Sum("amount"),
            payment_count=Count("id"),
            paid_order_count=Count("order_id", distinct=True),
        )
        total_sales = totals["total_sales"] or 0
        paid_order_ids = payments.values("order_id")
        product_sales = (
            OrderItem.objects.filter(order_id__in=paid_order_ids, is_cancelled=False)
            .values(
                "product_name",
                "product_image",
                "sku",
                "size",
                "color",
                "category__name",
            )
            .annotate(
                units_sold=Sum("quantity"),
                revenue=Sum("total_price"),
                order_count=Count("order_id", distinct=True),
            )
            .order_by("-revenue", "-units_sold", "product_name", "sku")
        )
        product_count = product_sales.count()
        top_products = list(product_sales[:100])
        for item in top_products:
            item["average_unit_price"] = (
                item["revenue"] / item["units_sold"]
                if item["units_sold"]
                else 0
            )
        product_totals = OrderItem.objects.filter(
            order_id__in=paid_order_ids, is_cancelled=False
        ).aggregate(units_sold=Sum("quantity"), product_revenue=Sum("total_price"))

        payment_methods = (
            payments.values("payment_method")
            .annotate(payment_count=Count("id"), amount=Sum("amount"))
            .order_by("-amount", "payment_method")
        )

        report_orders = (
            Order.objects.filter(pk__in=paid_order_ids)
            .select_related("user")
            .prefetch_related(
                Prefetch(
                    "items",
                    queryset=OrderItem.objects.order_by("id"),
                    to_attr="report_items",
                ),
                Prefetch(
                    "payments",
                    queryset=payments.order_by("created_at", "id"),
                    to_attr="report_paid_payments",
                ),
            )
            .order_by("-created_at", "-id")
        )
        order_details = []
        for order in report_orders:
            items = [
                {
                    "product_name": item.product_name,
                    "sku": item.sku,
                    "size": item.size,
                    "color": item.color,
                    "quantity": item.quantity,
                    "unit_price": item.price,
                    "line_total": item.total_price,
                    "is_cancelled": item.is_cancelled,
                }
                for item in order.report_items
            ]
            item_subtotal = sum(
                (
                    item.total_price
                    for item in order.report_items
                    if not item.is_cancelled
                ),
                start=Decimal("0.00"),
            )
            coupon_discount = order.coupon_discount_amount
            product_offer_discount = max(
                order.discount_amount - coupon_discount,
                Decimal("0.00"),
            )
            order_payments = [
                {
                    "method": payment.payment_method or "other",
                    "amount": payment.amount,
                    "transaction_id": payment.transaction_id or "",
                    "paid_at": payment.paid_at,
                }
                for payment in order.report_paid_payments
            ]
            customer_name = (
                order.user.get_full_name().strip()
                if order.user
                else ""
            ) or "Deleted customer"
            order_details.append(
                {
                    "order_number": order.order_number,
                    "created_at": order.created_at,
                    "customer_name": customer_name,
                    "customer_email": order.user.email if order.user else "",
                    "shipping_address": order.shipping_address or {},
                    "order_status": order.order_status,
                    "payment_method": order.payment_method or (
                        order_payments[0]["method"] if order_payments else "other"
                    ),
                    "payment_status": "paid",
                    "items": items,
                    "item_subtotal": item_subtotal,
                    "product_offer_discount": product_offer_discount,
                    "coupon_code": order.coupon_code or "",
                    "coupon_discount": coupon_discount,
                    "total_discount": order.discount_amount,
                    "shipping_charge": order.shipping_charge,
                    "order_total": order.total_amount,
                    "paid_amount": sum(
                        (payment.amount for payment in order.report_paid_payments),
                        start=Decimal("0.00"),
                    ),
                    "payments": order_payments,
                }
            )

        daily_sales = (
            payments
            .annotate(day=TruncDate("paid_at"))
            .values("day")
            .annotate(sales=Sum("amount"), payment_count=Count("id"))
            .order_by("day")
        )

        return Response({
            "start_date": str(start_date),
            "end_date": str(end_date),
            "total_sales": total_sales,
            "payment_count": totals["payment_count"] or 0,
            "paid_order_count": totals["paid_order_count"] or 0,
            "average_order_value": (
                total_sales / totals["paid_order_count"]
                if totals["paid_order_count"]
                else 0
            ),
            "units_sold": product_totals["units_sold"] or 0,
            "product_revenue": product_totals["product_revenue"] or 0,
            "product_count": product_count,
            "product_sales": top_products,
            "payment_methods": [
                {
                    "method": item["payment_method"] or "other",
                    "payment_count": item["payment_count"],
                    "amount": item["amount"] or 0,
                }
                for item in payment_methods
            ],
            "orders": order_details,
            "daily_sales": [
                {
                    "date": str(item["day"]),
                    "sales": item["sales"] or 0,
                    "payment_count": item["payment_count"],
                }
                for item in daily_sales
            ],
        })