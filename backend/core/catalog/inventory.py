from django.db.models import Sum

from .models import InventoryLog, ProductVariant


def restore_order_stock(order, *, note):
    quantities = dict(
        order.items.filter(variant__isnull=False)
        .values("variant_id")
        .annotate(quantity=Sum("quantity"))
        .values_list("variant_id", "quantity")
    )
    variants = ProductVariant.objects.select_for_update().filter(
        pk__in=quantities
    ).order_by("id")

    for variant in variants:
        quantity = quantities[variant.id]
        variant.stock += quantity
        variant.save(update_fields=["stock", "updated_at"])
        InventoryLog.objects.create(
            variant=variant,
            type=InventoryLog.IN,
            quantity=quantity,
            note=note,
        )
