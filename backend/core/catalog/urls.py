from django.urls import path

from .views import (
    CategoryListView,
    ProductDetailView,
    ProductListView,
    ProductReviewListView,
    PublicOfferListView,
)

urlpatterns = [
    path("categories/", CategoryListView.as_view(), name="category-list"),
    path("offers/", PublicOfferListView.as_view(), name="public-offer-list"),
    path("products/", ProductListView.as_view(), name="product-list"),
    path("products/<slug:slug>/", ProductDetailView.as_view(), name="product-detail"),
    path("products/<slug:slug>/reviews/", ProductReviewListView.as_view(), name="product-reviews"),
]