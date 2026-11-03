from django.db.models import OuterRef, Q, Subquery
from django.utils.dateparse import parse_date
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from orders.models import Order, Payment

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
        queryset = Order.objects.select_related("user").prefetch_related("items").annotate(
            latest_payment_status=Subquery(latest_payment)
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
        from django.db.models import Sum, Count
        from django.db.models.functions import TruncDate
        from django.utils import timezone
        from rest_framework.response import Response
        from orders.models import Payment

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
        )

        daily_sales = (
            payments
            .annotate(day=TruncDate("paid_at"))
            .values("day")
            .annotate(sales=Sum("amount"))
            .order_by("day")
        )

        return Response({
            "start_date": str(start_date),
            "end_date": str(end_date),
            "total_sales": totals["total_sales"] or 0,
            "payment_count": totals["payment_count"] or 0,
            "daily_sales": [
                {
                    "date": str(item["day"]),
                    "sales": item["sales"] or 0,
                }
                for item in daily_sales
            ],
        })