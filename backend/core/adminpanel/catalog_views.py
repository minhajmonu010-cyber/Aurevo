from django.db import transaction
from django.db.models import Avg, Count, Exists, F, IntegerField, Max, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from catalog.models import Brand, Category, InventoryLog, Product, ProductImage, ProductVariant

from .analytics import category_shares, category_stats
from .catalog_serializers import (
    AdminBrandSerializer,
    AdminCategorySerializer,
    AdminImageSerializer,
    AdminProductListSerializer,
    AdminProductSerializer,
    AdminVariantSerializer,
    CategoryReorderSerializer,
    InventoryLogSerializer,
    StockAdjustSerializer,
)


class AdminPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class AdminBase:
    permission_classes = [IsAdminUser]  # 401 if not signed in, 403 if signed in but not an admin
    parser_classes = [MultiPartParser, FormParser, JSONParser]  # multipart is needed for picture uploads
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]  # edit with PATCH (only what changed)


def _flag(value):
    """'true' / 'false' from the address bar, or None when not given."""
    return {"true": True, "false": False}.get((value or "").lower())


class AdminCategoryViewSet(AdminBase, viewsets.ModelViewSet):
    """
    ?search=  ?status=active|blocked  ?sort=products_desc|products_asc|name|newest|priority  ?page=  ?page_size=
    The built-in "Uncategorized Archive" is not in the list.
    """

    serializer_class = AdminCategorySerializer
    pagination_class = AdminPagination

    SORTS = {
        "products_desc": ("-product_count", "name"),
        "products_asc": ("product_count", "name"),
        "name": ("name",),
        "newest": ("-created_at", "-id"),
        "priority": ("priority", "name"),
    }

    def get_queryset(self):
        params = self.request.query_params
        queryset = Category.objects.select_related("parent").annotate(product_count=Count("products", distinct=True))
        if self.action == "list":
            queryset = queryset.filter(is_system=False)
            search = params.get("search", "").strip()
            if search:
                queryset = queryset.filter(Q(name__icontains=search) | Q(slug__icontains=search) | Q(description__icontains=search))
            if params.get("status") == "active":
                queryset = queryset.filter(is_active=True)
            elif params.get("status") == "blocked":
                queryset = queryset.filter(is_active=False)
            queryset = queryset.order_by(*self.SORTS.get(params.get("sort"), self.SORTS["priority"]))
        return queryset

    def _category_share_data(self):
        if not hasattr(self, "_category_share_data_cache"):
            self._category_share_data_cache = category_shares()
        return self._category_share_data_cache

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["shares"] = self._category_share_data()[1]
        return context

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        response.data["share_basis"] = self._category_share_data()[0]
        return response

    @action(detail=False, methods=["get"])
    def stats(self, request):
        return Response(category_stats())

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """Body: {"order": [id, id, ...]} (first = shown first). Sets priority 1, 2, 3..."""
        serializer = CategoryReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data["order"]
        if Category.objects.filter(pk__in=ids, is_system=False).count() != len(ids):
            raise ValidationError({"order": "Unknown category in the list."})
        with transaction.atomic():
            for position, pk in enumerate(ids, start=1):
                Category.objects.filter(pk=pk).update(priority=position)
        return Response({"reordered": len(ids)})

    def destroy(self, request, *args, **kwargs):
        category = self.get_object()
        if category.is_system:
            return Response({"detail": "The archive category can't be deleted."}, status=status.HTTP_409_CONFLICT)
        archive = Category.archive()
        with transaction.atomic():
            moved = category.products.update(category=archive)  # no orphans: they wait in the archive until reassigned
            name = category.name
            if category.image:
                category.image.delete(save=False)  # remove the picture file too
            category.delete()  # its sub-categories become top-level
        return Response({
            "deleted": name,
            "reassigned": moved,
            "archive": archive.name,
            "deleted_at": timezone.now(),
            "deleted_by": request.user.email,
        })


class AdminBrandViewSet(AdminBase, viewsets.ModelViewSet):
    serializer_class = AdminBrandSerializer
    pagination_class = AdminPagination

    def get_queryset(self):
        queryset = Brand.objects.annotate(product_count=Count("products"))
        search = self.request.query_params.get("search", "").strip()
        return queryset.filter(name__icontains=search) if search else queryset

    def perform_destroy(self, instance):
        instance.logo.delete(save=False)
        instance.delete()  # its products stay, without a brand


class AdminProductViewSet(AdminBase, viewsets.ModelViewSet):
    """
    ?search= (name, slug, SKU)  ?category=<id>  ?brand=<id>  ?status=active|hidden  ?is_featured=true|false
    ?stock=low|out  ?sort=newest|oldest|name|price_asc|price_desc|stock_asc|stock_desc  ?page=  ?page_size=
    """

    pagination_class = AdminPagination

    SORTS = {
        "newest": ("-created_at", "-id"),
        "oldest": ("created_at", "id"),
        "name": ("name", "id"),
        "price_asc": (F("min_price_db").asc(nulls_last=True), "id"),
        "price_desc": (F("min_price_db").desc(nulls_last=True), "id"),
        "stock_asc": ("stock_total", "id"),
        "stock_desc": ("-stock_total", "id"),
    }

    def get_serializer_class(self):
        return AdminProductListSerializer if self.action == "list" else AdminProductSerializer

    def get_queryset(self):
        params = self.request.query_params
        variants = ProductVariant.objects.filter(product=OuterRef("pk"))
        queryset = Product.objects.select_related("category", "brand")
        if self.action == "list":
            queryset = queryset.prefetch_related("images")
        else:
            queryset = queryset.prefetch_related("variants", "images")
        queryset = (
            queryset
            .annotate(
                stock_total=Coalesce(
                    Subquery(variants.values("product").annotate(n=Sum("stock")).values("n"), output_field=IntegerField()), 0
                ),
                min_price_db=Subquery(variants.order_by("price").values("price")[:1]),
                max_price_db=Subquery(
                    variants.order_by().values("product").annotate(value=Max("price")).values("value")[:1]
                ),
                variant_count_db=Coalesce(
                    Subquery(variants.order_by().values("product").annotate(value=Count("id")).values("value")[:1]),
                    0,
                ),
                has_variants=Exists(variants),
                has_low=Exists(variants.filter(is_active=True, stock__lte=OuterRef("low_stock_threshold"))),
                active_variant_count=Coalesce(
                    Subquery(
                        variants.filter(is_active=True).order_by().values("product")
                        .annotate(value=Count("id")).values("value")[:1]
                    ),
                    0,
                ),
                active_stock_total=Coalesce(
                    Subquery(
                        variants.filter(is_active=True).order_by().values("product")
                        .annotate(value=Sum("stock")).values("value")[:1]
                    ),
                    0,
                ),
            )
        )

        search = params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) | Q(slug__icontains=search) | Q(sku__icontains=search) | Q(variants__sku__icontains=search)
            ).distinct()
        if params.get("category", "").isdigit():
            queryset = queryset.filter(category_id=int(params["category"]))
        if params.get("brand", "").isdigit():
            queryset = queryset.filter(brand_id=int(params["brand"]))
        if params.get("status") == "active":
            queryset = queryset.filter(is_active=True)
        elif params.get("status") == "hidden":
            queryset = queryset.filter(is_active=False)
        for name in ("is_active", "is_featured"):
            wanted = _flag(params.get(name))
            if wanted is not None:
                queryset = queryset.filter(**{name: wanted})
        if params.get("stock") == "low":
            queryset = queryset.filter(has_low=True)
        elif params.get("stock") == "out":
            queryset = queryset.filter(has_variants=True, stock_total=0)
        return queryset.order_by(*self.SORTS.get(params.get("sort"), self.SORTS["newest"]))

    @action(detail=False, methods=["get"])
    def stats(self, request):
        stats = Product.objects.aggregate(
            total=Count("id", distinct=True),
            active=Count("id", filter=Q(is_active=True), distinct=True),
            hidden=Count("id", filter=Q(is_active=False), distinct=True),
            low_stock=Count(
                "id",
                filter=Q(
                    variants__is_active=True,
                    variants__stock__lte=F("low_stock_threshold"),
                ),
                distinct=True,
            ),
            average_price=Avg(
                "variants__price",
                filter=Q(variants__is_active=True),
            ),
        )
        average = stats["average_price"]
        return Response({
            "total": stats["total"],
            "active": stats["active"],
            "hidden": stats["hidden"],
            "low_stock": stats["low_stock"],
            "average_price": f"{average:.2f}" if average is not None else None,
        })

    def destroy(self, request, *args, **kwargs):
        product = self.get_object()
        summary = {
            "deleted": product.name,
            "variants_removed": product.variants.count(),
            "images_removed": product.images.count(),
            "stock_removed": sum(v.stock for v in product.variants.all()),
            "deleted_at": timezone.now(),
            "deleted_by": request.user.email,
        }
        with transaction.atomic():
            for picture in product.images.all():
                picture.image.delete(save=False)  # remove the picture files too
            product.delete()  # variants, picture rows and stock logs go with it; order lines keep their copy of the details
        return Response(summary)

    @action(detail=True, methods=["get", "post"], url_path="variants")
    def variants(self, request, pk=None):
        product = self.get_object()
        if request.method == "GET":
            return Response(AdminVariantSerializer(product.variants.all(), many=True).data)
        serializer = AdminVariantSerializer(data=request.data, context={"product": product})
        serializer.is_valid(raise_exception=True)
        serializer.save(product=product)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"], url_path="images")
    def images(self, request, pk=None):
        product = self.get_object()
        if request.method == "GET":
            return Response(AdminImageSerializer(product.images.all(), many=True, context={"request": request}).data)
        serializer = AdminImageSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            product = Product.objects.select_for_update().get(pk=product.pk)
            if product.images.count() >= 3:
                raise ValidationError({"image": "A product can have up to 3 images."})
            # the first picture is the main one; later ones only if asked
            make_primary = bool(serializer.validated_data.get("is_primary")) or not product.images.exists()
            if make_primary:
                product.images.filter(is_primary=True).update(is_primary=False)
            serializer.save(product=product, is_primary=make_primary)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AdminVariantViewSet(
    AdminBase, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    queryset = ProductVariant.objects.select_related("product")
    serializer_class = AdminVariantSerializer

    @action(detail=True, methods=["post"])
    def stock(self, request, pk=None):
        """Add (IN) or remove (OUT) stock. The change and its log entry are saved together."""
        serializer = StockAdjustSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            variant = ProductVariant.objects.select_for_update().get(pk=self.get_object().pk)  # lock: no lost updates
            if data["type"] == InventoryLog.OUT:
                if data["quantity"] > variant.stock:
                    raise ValidationError({"quantity": f"Only {variant.stock} in stock."})
                variant.stock -= data["quantity"]
            else:
                variant.stock += data["quantity"]
            variant.save(update_fields=["stock", "updated_at"])
            InventoryLog.objects.create(variant=variant, type=data["type"], quantity=data["quantity"], note=data.get("note", ""))
        return Response(AdminVariantSerializer(variant).data)

    @action(detail=True, methods=["get"])
    def logs(self, request, pk=None):
        """The last 100 stock changes of this variant, newest first."""
        entries = self.get_object().logs.all()[:100]
        return Response(InventoryLogSerializer(entries, many=True).data)


class AdminImageViewSet(AdminBase, mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    queryset = ProductImage.objects.select_related("product")
    serializer_class = AdminImageSerializer

    def perform_update(self, serializer):
        with transaction.atomic():
            if serializer.validated_data.get("is_primary"):  # only one main picture per product
                ProductImage.objects.filter(product=serializer.instance.product, is_primary=True).exclude(
                    pk=serializer.instance.pk
                ).update(is_primary=False)
            serializer.save()

    def perform_destroy(self, instance):
        product, was_primary = instance.product, instance.is_primary
        instance.image.delete(save=False)  # remove the file too
        instance.delete()
        if was_primary:  # the next picture becomes the main one
            next_picture = product.images.order_by("id").first()
            if next_picture:
                next_picture.is_primary = True
                next_picture.save(update_fields=["is_primary"])
