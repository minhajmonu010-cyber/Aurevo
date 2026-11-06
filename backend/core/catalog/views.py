# Create your views here.
from django.db.models import Avg, Count, Min, Prefetch, Q
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny

from adminpanel.models import Offer

from .models import Category, Product, ProductVariant, Review
from .serializers import (
    CategorySerializer,
    ProductDetailSerializer,
    ProductListSerializer,
    PublicOfferSerializer,
    PublicReviewSerializer,
)


def visible_products():
    """Active products in an active category that have at least one active variant (otherwise there is no price to show)."""
    active_variants = ProductVariant.objects.filter(is_active=True).order_by("price", "id")
    return (
        Product.objects.filter(is_active=True, category__is_active=True)  # a blocked or archived category hides its products
        .annotate(
            min_price=Min("variants__price", filter=Q(variants__is_active=True)),
            average_rating=Avg("reviews__rating", filter=Q(reviews__is_approved=True)),
            review_count=Count("reviews", filter=Q(reviews__is_approved=True), distinct=True),
        )
        .filter(min_price__isnull=False)
        .select_related("category", "brand")
        .prefetch_related(Prefetch("variants", queryset=active_variants, to_attr="active_variants"), "images")
    )


class PublicView:
    authentication_classes = []  # shoppers can be signed out; an old token must not block the page
    permission_classes = [AllowAny]


class ShopPagination(PageNumberPagination):
    page_size = 12
    page_size_query_param = "page_size"
    max_page_size = 48


class ReviewPagination(PageNumberPagination):
    page_size = 5
    page_size_query_param = "page_size"
    max_page_size = 20


ORDERINGS = {
    "newest": ("-created_at", "-id"),
    "price_asc": ("min_price", "id"),
    "price_desc": ("-min_price", "id"),
    "featured": ("-is_featured", "-created_at", "-id"),  # featured products first, then the newest
}


class CategoryListView(PublicView, ListAPIView):
    """Active categories shoppers can browse, including categories with no products yet."""

    serializer_class = CategorySerializer
    pagination_class = None

    def get_queryset(self):
        return (
            Category.objects.filter(is_active=True, is_system=False)  # "Blocked" categories are hidden
            .annotate(
                product_count=Count(
                    "products",
                    filter=Q(products__is_active=True, products__variants__is_active=True),
                    distinct=True,
                )
            )
            .order_by("priority", "name")  # the admin's display order
        )


class PublicOfferListView(PublicView, ListAPIView):
    serializer_class = PublicOfferSerializer
    pagination_class = None

    def get_queryset(self):
        now = timezone.now()
        return Offer.objects.filter(
            is_active=True,
            start_date__lte=now,
            end_date__gte=now,
        ).order_by("end_date", "id")

    def list(self, request, *args, **kwargs):
        offers = list(self.filter_queryset(self.get_queryset()))
        product_ids = {
            target_id
            for offer in offers
            if offer.applies_to == Offer.PRODUCTS
            for target_id in offer.target_ids
        }
        category_ids = {
            target_id
            for offer in offers
            if offer.applies_to == Offer.CATEGORIES
            for target_id in offer.target_ids
        }
        product_targets = {
            target_id: {"name": name, "slug": slug}
            for target_id, name, slug in Product.objects.filter(
                pk__in=product_ids,
                is_active=True,
                category__is_active=True,
            ).values_list("id", "name", "slug")
        }
        category_targets = {
            target_id: {"name": name, "slug": slug}
            for target_id, name, slug in Category.objects.filter(
                pk__in=category_ids,
                is_active=True,
                is_system=False,
            ).values_list("id", "name", "slug")
        }
        target_names = {}
        target_slugs = {}
        for offer in offers:
            targets_by_id = (
                product_targets if offer.applies_to == Offer.PRODUCTS
                else category_targets if offer.applies_to == Offer.CATEGORIES
                else {}
            )
            target_names[offer.pk] = [
                targets_by_id[target_id]["name"]
                for target_id in offer.target_ids
                if target_id in targets_by_id
            ]
            target_slugs[offer.pk] = [
                targets_by_id[target_id]["slug"]
                for target_id in offer.target_ids
                if target_id in targets_by_id
            ]

        serializer = self.get_serializer(
            offers,
            many=True,
            context={
                **self.get_serializer_context(),
                "target_names": target_names,
                "target_slugs": target_slugs,
            },
        )
        return Response(serializer.data)


class ProductListView(PublicView, ListAPIView):
    """?category=<slug>  ?featured=true  ?search=<text>  ?ordering=newest|price_asc|price_desc|featured  ?page=  ?page_size="""

    serializer_class = ProductListSerializer
    pagination_class = ShopPagination

    def get_queryset(self):
        params = self.request.query_params
        queryset = visible_products()

        if params.get("category"):
            queryset = queryset.filter(category__slug=params["category"])
        if params.get("featured", "").lower() == "true":
            queryset = queryset.filter(is_featured=True)
        search = params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(description__icontains=search)
                | Q(category__name__icontains=search)
                | Q(brand__name__icontains=search)
            )
        return queryset.order_by(*ORDERINGS.get(params.get("ordering"), ORDERINGS["newest"]))


class ProductDetailView(PublicView, RetrieveAPIView):
    serializer_class = ProductDetailSerializer
    lookup_field = "slug"

    def get_queryset(self):
        return visible_products()


class ProductReviewListView(PublicView, ListAPIView):
    serializer_class = PublicReviewSerializer
    pagination_class = ReviewPagination

    def get_queryset(self):
        return Review.objects.filter(
            product__slug=self.kwargs["slug"],
            product__is_active=True,
            product__category__is_active=True,
            product__variants__is_active=True,
            is_approved=True,
        ).select_related("user").distinct().order_by("-created_at", "-id")

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page, many=True)
        response = self.get_paginated_response(serializer.data)
        summary = queryset.aggregate(
            average_rating=Avg("rating"),
            **{
                f"rating_{rating}": Count("id", filter=Q(rating=rating))
                for rating in range(1, 6)
            },
        )
        response.data["average_rating"] = round(
            summary["average_rating"] or 0, 1
        )
        response.data["rating_distribution"] = {
            str(rating): summary[f"rating_{rating}"]
            for rating in range(1, 6)
        }
        return response