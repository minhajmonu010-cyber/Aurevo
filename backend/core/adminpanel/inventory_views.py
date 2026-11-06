from django.db.models import Case, CharField, Count, F, IntegerField, Prefetch, Q, Sum, Value, When
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAdminUser

from catalog.models import ProductImage, ProductVariant


class InventoryView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        search = request.query_params.get("search", "").strip()
        status = request.query_params.get("status", "all")
        try:
            page = max(1, int(request.query_params.get("page", 1)))
            page_size = min(100, max(1, int(request.query_params.get("page_size", 50))))
        except (TypeError, ValueError):
            return Response(
                {"detail": "Page and page size must be whole numbers."},
                status=400,
            )

        variants = ProductVariant.objects.select_related(
            "product",
            "product__category",
        ).annotate(
            stock_status=Case(
                When(stock__lte=0, then=Value("out")),
                When(stock__lte=F("product__low_stock_threshold"), then=Value("low")),
                default=Value("healthy"),
                output_field=CharField(),
            )
        ).order_by("product__name", "size", "color", "id")

        if search:
            variants = variants.filter(
                Q(product__name__icontains=search)
                | Q(sku__icontains=search)
                | Q(product__sku__icontains=search)
            )

        if status in {"out", "low", "healthy"}:
            variants = variants.filter(stock_status=status)
        elif status == "alerts":
            variants = variants.filter(stock_status__in=("low", "out"))
        elif status != "all":
            variants = variants.none()

        summary = variants.aggregate(
            variant_count=Count("id"),
            stock_units=Sum(
                Case(
                    When(stock__gt=0, then=F("stock")),
                    default=Value(0),
                    output_field=IntegerField(),
                )
            ),
            low_stock=Count("id", filter=Q(stock_status="low")),
            out_of_stock=Count("id", filter=Q(stock_status="out")),
        )
        start = (page - 1) * page_size
        page_variants = variants[start:start + page_size].prefetch_related(
            Prefetch(
                "product__images",
                queryset=ProductImage.objects.order_by("-is_primary", "id"),
                to_attr="inventory_images",
            )
        )
        rows = []
        for variant in page_variants:
            images = variant.product.inventory_images
            image = images[0].image.url if images else None
            rows.append({
                "id": variant.id,
                "product_name": variant.product.name,
                "image": request.build_absolute_uri(image) if image else None,
                "sku": variant.sku,
                "size": variant.size,
                "color": variant.color,
                "stock": variant.stock,
                "threshold": variant.product.low_stock_threshold,
                "status": variant.stock_status,
            })

        return Response({
            "count": summary["variant_count"],
            "page": page,
            "page_size": page_size,
            "summary": {
                "variant_count": summary["variant_count"],
                "stock_units": summary["stock_units"] or 0,
                "low_stock": summary["low_stock"],
                "out_of_stock": summary["out_of_stock"],
            },
            "results": rows,
        })