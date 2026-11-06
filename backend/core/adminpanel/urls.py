from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .inventory_views import InventoryView
from .dashboard_views import SalesReportView
from .order_views import (
    AdminOrderDetailView,
    AdminOrderListView,
    AdminOrderRefundStatusView,
    AdminOrderStatusView,
    AdminOrderWalletRefundView,
)
from .customer_views import (AdminCustomerListView,AdminCustomerDetailView,)
from .return_views import (AdminReturnListView,AdminReturnStatusView,)
from .coupon_views import (AdminCouponListCreateView,AdminCouponDetailView,)
from .wallet_views import (AdminWalletOverviewView,AdminWalletTransactionListView,AdminWalletCustomerListView,)
from .offer_views import (AdminOfferListCreateView,AdminOfferDetailView,)
from .review_views import (
    admin_reviews,
    admin_review_detail,
)
from . import views

urlpatterns = [
    path("login/", views.AdminLoginView.as_view()),
    path("logout/", views.AdminLogoutView.as_view()),
    path("token/refresh/", TokenRefreshView.as_view()),
    path("inventory/", InventoryView.as_view(), name="admin-inventory"),
    path("sales-report/",SalesReportView.as_view(),name="admin-sales-report"),
    path("orders/", AdminOrderListView.as_view(), name="admin-orders"),
    path("orders/<int:order_id>/", AdminOrderDetailView.as_view(), name="admin-order-detail"),
    path("orders/<int:order_id>/status/", AdminOrderStatusView.as_view(), name="admin-order-status"),
    path("orders/<int:order_id>/refund-status/", AdminOrderRefundStatusView.as_view(), name="admin-order-refund-status"),
    path("orders/<int:order_id>/wallet-refund/", AdminOrderWalletRefundView.as_view(), name="admin-order-wallet-refund"),
    path("customers/",AdminCustomerListView.as_view(),name="admin-customers",),
    path("customers/<int:customer_id>/",AdminCustomerDetailView.as_view(),name="admin-customer-detail",),
    path("returns/",AdminReturnListView.as_view(),name="admin-returns",),
    path("returns/<int:return_id>/status/",AdminReturnStatusView.as_view(),name="admin-return-status",),
    path("coupons/",AdminCouponListCreateView.as_view(),name="admin-coupons",),
    path("coupons/<int:coupon_id>/",AdminCouponDetailView.as_view(),name="admin-coupon-detail",),
    path("wallet/overview/",AdminWalletOverviewView.as_view(),name="admin-wallet-overview",),
    path("wallet/transactions/",AdminWalletTransactionListView.as_view(),name="admin-wallet-transactions",),
    path("wallet/customers/",AdminWalletCustomerListView.as_view(),name="admin-wallet-customers",),
    path("offers/",AdminOfferListCreateView.as_view(),name="admin-offers",),
    path("offers/<int:offer_id>/",AdminOfferDetailView.as_view(),name="admin-offer-detail",),
    path("reviews/",admin_reviews,name="admin-reviews",),
    path("reviews/<int:review_id>/",admin_review_detail,name="admin-review-detail",),
    path("me/", views.AdminMeView.as_view()),
]