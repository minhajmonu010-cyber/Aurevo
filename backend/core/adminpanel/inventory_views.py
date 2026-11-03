from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAdminUser

from catalog.models import ProductVariant


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
        ).prefetch_related("product__images").order_by("product__name", "size", "color", "id")

        if search:
            variants = variants.filter(
                Q(product__name__icontains=search)
                | Q(sku__icontains=search)
                | Q(product__sku__icontains=search)
            )

        rows = []

        for variant in variants:
            stock = variant.stock
            threshold = getattr(
                variant.product,
                "low_stock_threshold",
                5,
            )

            if stock <= 0:
                stock_status = "out"
            elif stock <= threshold:
                stock_status = "low"
            else:
                stock_status = "healthy"

            if status != "all" and status != stock_status:
                continue

            images = variant.product.images.all()
            image = images[0].image.url if images else None

            rows.append({
                "id": variant.id,
                "product_name": variant.product.name,
                "image": request.build_absolute_uri(image) if image else None,
                "sku": variant.sku,
                "size": getattr(variant, "size", ""),
                "color": getattr(variant, "color", ""),
                "stock": stock,
                "threshold": threshold,
                "status": stock_status,
            })

        count = len(rows)
        start = (page - 1) * page_size
        return Response({
            "count": count,
            "page": page,
            "page_size": page_size,
            "summary": {
                "variant_count": len(rows),
                "stock_units": sum(
                    max(0, row["stock"]) for row in rows
                ),
                "low_stock": sum(
                    row["status"] == "low" for row in rows
                ),
                "out_of_stock": sum(
                    row["status"] == "out" for row in rows
                ),
            },
            "results": rows[start:start + page_size],
        })