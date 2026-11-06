from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone

from adminpanel.models import Offer
from .models import Product


def offer_prices(variants, now=None):
    variants = list(variants)
    if not variants:
        return {}

    now = now or timezone.now()
    offers = list(
        Offer.objects.filter(
            is_active=True,
            start_date__lte=now,
            end_date__gte=now,
        ).order_by("id")
    )
    if not offers:
        return {
            variant.id: {"price": variant.price, "discount": Decimal("0.00"), "name": ""}
            for variant in variants
        }

    product_category_ids = {}
    unresolved_product_ids = set()
    for variant in variants:
        product = variant._state.fields_cache.get("product")
        if product is None:
            unresolved_product_ids.add(variant.product_id)
        else:
            product_category_ids[variant.product_id] = product.category_id
    if unresolved_product_ids:
        product_category_ids.update(
            Product.objects.filter(pk__in=unresolved_product_ids).values_list(
                "id",
                "category_id",
            )
        )

    prices = {}
    for variant in variants:
        product_id = variant.product_id
        category_id = product_category_ids[product_id]
        best_offer = None
        best_discount = Decimal("0.00")

        for offer in offers:
            if offer.applies_to == Offer.PRODUCTS and product_id not in offer.target_ids:
                continue
            if offer.applies_to == Offer.CATEGORIES and category_id not in offer.target_ids:
                continue

            if offer.discount_type == Offer.PERCENTAGE:
                discount = variant.price * offer.discount_value / Decimal("100")
            else:
                discount = offer.discount_value
            discount = min(variant.price, discount).quantize(
                Decimal("0.01"),
                rounding=ROUND_HALF_UP,
            )

            if discount > best_discount:
                best_offer = offer
                best_discount = discount

        prices[variant.id] = {
            "price": variant.price - best_discount,
            "discount": best_discount,
            "name": best_offer.name if best_offer else "",
        }

    return prices
