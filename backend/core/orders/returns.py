from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Sum

from .models import Order, OrderItem, OrderReturn


def calculate_item_return_refund(order: Order, item: OrderItem) -> Decimal:
    prefetched_items = getattr(order, "_prefetched_objects_cache", {}).get("items")
    all_items = (
        list(prefetched_items)
        if prefetched_items is not None
        else list(order.items.all())
    )
    active_items = [order_item for order_item in all_items if not order_item.is_cancelled]
    subtotal = sum(
        (order_item.total_price for order_item in active_items),
        start=Decimal("0.00"),
    )
    if subtotal <= 0 or item.is_cancelled:
        return Decimal("0.00")

    coupon_discount = min(order.coupon_discount_amount, subtotal)
    item_coupon_share = (
        coupon_discount * item.total_price / subtotal
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    item_refund = max(item.total_price - item_coupon_share, Decimal("0.00"))

    if not hasattr(order, "_return_refund_reserved_total"):
        if prefetched_items is not None:
            order._return_refund_reserved_total = sum(
                (
                    return_request.refund_amount
                    for order_item in all_items
                    for return_request in order_item.return_requests.all()
                    if return_request.status in {
                        OrderReturn.REQUESTED,
                        OrderReturn.APPROVED,
                    }
                ),
                start=Decimal("0.00"),
            )
        else:
            order._return_refund_reserved_total = order.return_requests.filter(
                item__isnull=False,
                status__in=(OrderReturn.REQUESTED, OrderReturn.APPROVED),
            ).aggregate(total=Sum("refund_amount"))["total"] or Decimal("0.00")
    already_reserved = order._return_refund_reserved_total
    paid_item_total = max(subtotal - coupon_discount, Decimal("0.00"))
    remaining_refundable = max(paid_item_total - already_reserved, Decimal("0.00"))
    return min(item_refund, remaining_refundable).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )
