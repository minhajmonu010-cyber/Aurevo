from django.urls import path

from .views import CartItemView, CartView, WishlistItemView, WishlistView

urlpatterns = [
    path("cart/", CartView.as_view(), name="shop-cart"),
    path("cart/<int:pk>/", CartItemView.as_view(), name="shop-cart-item"),
    path("wishlist/", WishlistView.as_view(), name="shop-wishlist"),
    path("wishlist/<int:pk>/", WishlistItemView.as_view(), name="shop-wishlist-item"),
]