from django.urls import path
from .address_views import (
    AddressListCreateView,
    AddressDetailView,
)

urlpatterns = [
    path("", AddressListCreateView.as_view(), name="address-list-create"),
    path("<int:pk>/", AddressDetailView.as_view(), name="address-detail"),
]