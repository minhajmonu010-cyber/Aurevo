from django.urls import path
from .dashboard_views import SalesReportView
from . import dashboard_views as views

urlpatterns = [
    path("", views.DashboardView.as_view()),
    path("orders/", views.DashboardOrdersView.as_view()),
    path("sales-report/",SalesReportView.as_view(),name="admin-sales-report",),
]