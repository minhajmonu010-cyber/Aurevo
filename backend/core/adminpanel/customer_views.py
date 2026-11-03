from django.contrib.auth import get_user_model
from django.db.models import Count, Max, OuterRef, Q, Subquery, Sum
from django.utils.dateparse import parse_date
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import AdminCustomerStatusSerializer
from orders.models import Order, Payment

User = get_user_model()


def _customers_queryset():
    paid_spend = (
        Payment.objects.filter(order__user_id=OuterRef("pk"), payment_status=Payment.PAID)
        .values("order__user_id")
        .annotate(total=Sum("amount"))
        .values("total")[:1]
    )
    return (
        User.objects.filter(is_staff=False)
        .annotate(
            total_orders=Count("orders", distinct=True),
            last_order=Max("orders__created_at"),
            total_spent=Subquery(paid_spend),
        )
    )


def serialize_customer(user):
    return {
        "id": user.pk,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "name": user.get_full_name().strip() or user.email or str(user.pk),
        "email": user.email,
        "phone": user.phone or "",
        "is_active": user.is_active,
        "is_verified": user.is_verified,
        "date_joined": user.created_at.isoformat() if user.created_at else None,
        "total_orders": getattr(user, "total_orders", 0) or 0,
        "total_spent": str(getattr(user, "total_spent", None) or "0.00"),
        "last_order": user.last_order.isoformat() if getattr(user, "last_order", None) else None,
    }


def _date_filter(value, field):
    if not value:
        return None, None
    try:
        result = parse_date(value)
    except ValueError:
        result = None
    if result is None:
        return None, Response({"detail": f"Invalid {field} date. Use YYYY-MM-DD."}, status=400)
    return result, None


class AdminCustomerListView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        params = request.query_params
        customers = _customers_queryset()
        search = params.get("search", "").strip()
        if search:
            customers = customers.filter(
                Q(email__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(phone__icontains=search)
            )

        customer_status = params.get("status", "all").lower()
        if customer_status == "active":
            customers = customers.filter(is_active=True)
        elif customer_status == "inactive":
            customers = customers.filter(is_active=False)
        elif customer_status == "verified":
            customers = customers.filter(is_verified=True)
        elif customer_status == "unverified":
            customers = customers.filter(is_verified=False)
        elif customer_status not in ("", "all"):
            return Response({"detail": "Status must be active, inactive, verified, or unverified."}, status=400)

        start_date, error = _date_filter(params.get("start"), "start")
        if error:
            return error
        end_date, error = _date_filter(params.get("end"), "end")
        if error:
            return error
        if start_date and end_date and start_date > end_date:
            return Response({"detail": "Start date must be before or equal to end date."}, status=400)
        if start_date:
            customers = customers.filter(created_at__date__gte=start_date)
        if end_date:
            customers = customers.filter(created_at__date__lte=end_date)

        sort_fields = {
            "newest": ("-created_at", "-id"),
            "oldest": ("created_at", "id"),
            "name": ("first_name", "last_name", "id"),
            "orders": ("-total_orders", "-created_at"),
            "spend": ("-total_spent", "-created_at"),
        }
        sort = params.get("sort", "newest")
        if sort not in sort_fields:
            return Response({"detail": "Invalid sort order."}, status=400)
        customers = customers.order_by(*sort_fields[sort])

        try:
            page = max(1, int(params.get("page", 1)))
            page_size = min(100, max(1, int(params.get("page_size", 20))))
        except (ValueError, TypeError):
            return Response({"detail": "Page and page size must be whole numbers."}, status=400)

        all_customers = _customers_queryset()
        total = all_customers.count()
        stats = all_customers.aggregate(
            active=Count("id", distinct=True, filter=Q(is_active=True)),
            verified=Count("id", distinct=True, filter=Q(is_verified=True)),
        )
        stats["repeat"] = all_customers.filter(total_orders__gte=2).count()
        count = customers.count()
        results = customers[(page - 1) * page_size:page * page_size]
        return Response({
            "count": count,
            "page": page,
            "page_size": page_size,
            "summary": {
                "total": total,
                "active": stats["active"] or 0,
                "verified": stats["verified"] or 0,
                "repeat": stats["repeat"] or 0,
            },
            "results": [serialize_customer(customer) for customer in results],
        })


class AdminCustomerDetailView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request, customer_id):
        try:
            customer = _customers_queryset().get(pk=customer_id)
        except User.DoesNotExist:
            return Response({"detail": "Customer not found."}, status=404)

        order_rows = []
        orders = (
            Order.objects.filter(user=customer)
            .annotate(item_count=Sum("items__quantity"))
            .annotate(payment_status=Subquery(
                Payment.objects.filter(order=OuterRef("pk")).order_by("-created_at", "-id").values("payment_status")[:1]
            ))
            .order_by("-created_at", "-id")[:20]
        )
        for order in orders:
            order_rows.append({
                "id": order.id,
                "order_number": order.order_number,
                "order_status": order.order_status,
                "payment_status": order.payment_status or Payment.PENDING,
                "total_amount": str(order.total_amount),
                "created_at": order.created_at.isoformat(),
                "item_count": order.item_count or 0,
            })

        result = serialize_customer(customer)
        result["orders"] = order_rows
        result["wallet_balance"] = str(getattr(getattr(customer, "wallet", None), "balance", 0))
        return Response(result)

    def patch(self, request, customer_id):
        serializer = AdminCustomerStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            customer = _customers_queryset().get(pk=customer_id)
        except User.DoesNotExist:
            return Response({"detail": "Customer not found."}, status=404)
        customer.is_active = serializer.validated_data["is_active"]
        customer.save(update_fields=["is_active"])
        return Response({"message": "Customer status updated.", "customer": serialize_customer(customer)})
