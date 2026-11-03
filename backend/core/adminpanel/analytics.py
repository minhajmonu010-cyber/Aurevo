from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Count, Exists, F, OuterRef, Q, Sum
from django.db.models.functions import TruncDate, TruncMonth
from django.utils import timezone

from catalog.models import Category, Product, ProductVariant
from orders.models import Order, OrderItem, Payment

ZERO = Decimal("0.00")
CRITICAL_STOCK = 3  # this many or fewer left = critical


def money(value):
    return f"{(value or ZERO):.2f}"


def pct_change(current, previous):
    """+18.4 means 18.4% more than before. None when there is nothing to compare with."""
    if not previous:
        return None
    return round(float((Decimal(current) - Decimal(previous)) / Decimal(previous) * 100), 1)


def low_stock_variants():
    """Active variants of active products with this many or fewer units left (the product's own alert level)."""
    return ProductVariant.objects.filter(
        is_active=True, product__is_active=True, stock__lte=F("product__low_stock_threshold")
    )


def _chart(range_key, now):
    """Sales per day (7d, 30d) or per month (12m), oldest first."""
    if range_key == "12m":
        first = (now.replace(day=1) - timedelta(days=330)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        rows = (
            Payment.objects.filter(payment_status=Payment.PAID, paid_at__gte=first)
            .annotate(bucket=TruncMonth("paid_at")).values("bucket").annotate(total=Sum("amount"))
        )
        totals = {row["bucket"].date().replace(day=1): row["total"] for row in rows}
        months, cursor = [], now.date().replace(day=1)
        for _ in range(12):
            months.append(cursor)
            cursor = (cursor - timedelta(days=1)).replace(day=1)
        months.reverse()
        return [
            {"date": m.isoformat(), "label": m.strftime("%b"), "full_label": m.strftime("%B %Y"), "value": money(totals.get(m))}
            for m in months
        ]

    days = 30 if range_key == "30d" else 7
    today = timezone.localdate()
    start = today - timedelta(days=days - 1)
    rows = (
        Payment.objects.filter(payment_status=Payment.PAID, paid_at__date__gte=start)
        .annotate(bucket=TruncDate("paid_at")).values("bucket").annotate(total=Sum("amount"))
    )
    totals = {row["bucket"]: row["total"] for row in rows}
    out = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        out.append({
            "date": day.isoformat(),
            "label": day.strftime("%a") if days == 7 else day.strftime("%d %b"),
            "full_label": day.strftime("%A") if days == 7 else day.strftime("%d %B"),
            "value": money(totals.get(day)),
        })
    return out


def dashboard_summary(range_key="7d"):
    now = timezone.now()
    last, before = (now - timedelta(days=30), now), (now - timedelta(days=60), now - timedelta(days=30))

    low = low_stock_variants()
    low_items = (
        low.select_related("product").prefetch_related("product__images").order_by("stock", "id")[:5]
    )

    points = _chart(range_key, now)
    peak = max(points, key=lambda p: Decimal(p["value"])) if points else None

    payment_stats = Payment.objects.filter(payment_status=Payment.PAID).aggregate(
        total=Sum("amount"),
        sales_now=Sum("amount", filter=Q(paid_at__gte=last[0], paid_at__lt=last[1])),
        sales_before=Sum("amount", filter=Q(paid_at__gte=before[0], paid_at__lt=before[1])),
        orders_now=Count("order_id", filter=Q(paid_at__gte=last[0], paid_at__lt=last[1]), distinct=True),
        orders_before=Count(
            "order_id",
            filter=Q(paid_at__gte=before[0], paid_at__lt=before[1]),
            distinct=True,
        ),
    )
    sales_now = payment_stats["sales_now"] or ZERO
    sales_before = payment_stats["sales_before"] or ZERO
    avg_now = sales_now / payment_stats["orders_now"] if payment_stats["orders_now"] else ZERO
    avg_before = sales_before / payment_stats["orders_before"] if payment_stats["orders_before"] else ZERO

    order_stats = Order.objects.exclude(order_status=Order.CANCELLED).aggregate(
        total=Count("id"),
        now=Count("id", filter=Q(created_at__gte=last[0], created_at__lt=last[1])),
        before=Count("id", filter=Q(created_at__gte=before[0], created_at__lt=before[1])),
    )

    buyers = Order.objects.exclude(order_status=Order.CANCELLED).exclude(user=None).values("user").annotate(n=Count("id"))
    buyer_stats = buyers.aggregate(
        total=Count("user"),
        repeat=Count("user", filter=Q(n__gte=2)),
    )
    buyer_total = buyer_stats["total"]
    repeat = buyer_stats["repeat"]

    sold = (
        OrderItem.objects.exclude(order__order_status__in=[Order.CANCELLED, Order.RETURNED]).aggregate(n=Sum("quantity"))["n"] or 0
    )
    in_stock = ProductVariant.objects.aggregate(n=Sum("stock"))["n"] or 0

    customer_stats = get_user_model().objects.filter(is_staff=False).aggregate(
        total=Count("id"),
        signups_now=Count("id", filter=Q(created_at__gte=last[0], created_at__lt=last[1])),
        signups_before=Count("id", filter=Q(created_at__gte=before[0], created_at__lt=before[1])),
    )
    low_stats = low.aggregate(
        count=Count("id"),
        critical=Count("id", filter=Q(stock__lte=CRITICAL_STOCK)),
    )

    return {
        "stats": {
            "total_sales": {
                "value": money(payment_stats["total"]),
                "change": pct_change(sales_now, sales_before),
            },
            "total_orders": {
                "value": order_stats["total"],
                "change": pct_change(order_stats["now"], order_stats["before"]),
            },
            "total_customers": {
                "value": customer_stats["total"],
                "change": pct_change(customer_stats["signups_now"], customer_stats["signups_before"]),
            },
            "low_stock": {"count": low_stats["count"], "critical": low_stats["critical"]},
        },
        "sales_chart": {
            "range": range_key,
            "points": points,
            "peak": {"label": peak["full_label"], "value": peak["value"]} if peak and Decimal(peak["value"]) > 0 else None,
        },
        "highlights": {
            "avg_order_value": {"value": money(avg_now), "change": pct_change(avg_now, avg_before)},
            "repeat_buyers": round(repeat / buyer_total * 100, 1) if buyer_total else 0,
            "sell_through": round(sold / (sold + in_stock) * 100, 1) if (sold + in_stock) else 0,
        },
        "low_stock_items": [
            {
                "variant_id": v.id,
                "product_id": v.product_id,
                "name": v.product.name,
                "size": v.size,
                "color": v.color,
                "stock": v.stock,
                "critical": v.stock <= CRITICAL_STOCK,
                "image": next((img.image.url for img in v.product.images.all()), None),
            }
            for v in low_items
        ],
        "low_stock_alerting": low_stats["count"],
    }


def category_shares():
    """
    Each category's share of sales in % (paid orders). While there are no sales yet, its share of the products instead.
    Returns (basis, {category_id: percent}).
    """
    paid = Payment.objects.filter(order=OuterRef("order_id"), payment_status=Payment.PAID)
    sales = (
        OrderItem.objects.annotate(paid=Exists(paid)).filter(paid=True, category__isnull=False)
        .values("category_id").annotate(total=Sum("total_price"))
    )
    grand = sum((row["total"] for row in sales), ZERO)
    if grand > 0:
        return "sales", {row["category_id"]: round(float(row["total"] / grand * 100)) for row in sales}

    counts = Product.objects.filter(category__is_system=False).values("category_id").annotate(n=Count("id"))
    total = sum(row["n"] for row in counts)
    if not total:
        return "products", {}
    return "products", {row["category_id"]: round(row["n"] / total * 100) for row in counts}


def category_stats():
    now = timezone.now()
    real = Category.objects.filter(is_system=False)
    total, active = real.count(), real.filter(is_active=True).count()
    basis, shares = category_shares()
    top = None
    if shares:
        top_id = max(shares, key=shares.get)
        top_category = real.filter(pk=top_id).first()
        if top_category:
            revenue = (
                OrderItem.objects.filter(
                    category=top_category, order__created_at__gte=now - timedelta(days=30),
                    order__payments__payment_status=Payment.PAID,
                ).distinct().aggregate(n=Sum("total_price"))["n"] or ZERO
            )
            top = {"id": top_id, "name": top_category.name, "share": shares[top_id], "revenue_30d": money(revenue)}
    return {
        "total": total,
        "new_30d": real.filter(created_at__gte=now - timedelta(days=30)).count(),
        "featured": real.filter(is_featured=True).count(),
        "active": active,
        "health": round(active / total * 100, 1) if total else 0,
        "tagged_products": Product.objects.filter(category__is_system=False).count(),
        "pending_assign": Product.objects.filter(category__is_system=True).count(),
        "share_basis": basis,
        "top": top,
    }