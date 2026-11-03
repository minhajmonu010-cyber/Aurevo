
from django.urls import path

from .views import (
    CustomerOrderListView,
    CustomerOrderDetailView,
    CustomerOrderCancelView,
    CustomerOrderReturnView,
    CustomerOrderItemReviewView,
    CustomerCheckoutView,
    CustomerAvailableCouponsView,
    CustomerPaymentVerifyView,
    CustomerPaymentCancelView,
)

urlpatterns = [
    path("checkout/", CustomerCheckoutView.as_view(), name="customer-checkout"),
    path("checkout/coupons/", CustomerAvailableCouponsView.as_view(), name="customer-available-coupons"),
    path("checkout/verify/", CustomerPaymentVerifyView.as_view(), name="customer-payment-verify"),
    path("checkout/cancel/", CustomerPaymentCancelView.as_view(), name="customer-payment-cancel"),
    path("", CustomerOrderListView.as_view(), name="customer-order-list"),
    path("<int:pk>/", CustomerOrderDetailView.as_view(), name="customer-order-detail"),
    path(
        "<int:pk>/cancel/",
        CustomerOrderCancelView.as_view(),
        name="customer-order-cancel",
    ),
    path(
        "<int:pk>/return/",
        CustomerOrderReturnView.as_view(),
        name="customer-order-return",
    ),
    path(
        "<int:order_id>/items/<int:item_id>/review/",
        CustomerOrderItemReviewView.as_view(),
        name="customer-order-item-review",
    ),
]
