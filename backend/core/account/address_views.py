from django.db import transaction
from rest_framework import generics, permissions, status
from rest_framework.response import Response

from .models import Address
from .address_serializers import AddressSerializer


class AddressListCreateView(generics.ListCreateAPIView):
    serializer_class = AddressSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Address.objects.filter(user=self.request.user)

    @transaction.atomic
    def perform_create(self, serializer):
        user_addresses = Address.objects.filter(user=self.request.user)
        make_default = serializer.validated_data.get("is_default", False)

        if make_default or not user_addresses.exists():
            user_addresses.update(is_default=False)
            serializer.save(user=self.request.user, is_default=True)
        else:
            serializer.save(user=self.request.user)


class AddressDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = AddressSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Address.objects.filter(user=self.request.user)

    @transaction.atomic
    def perform_update(self, serializer):
        address = self.get_object()
        make_default = serializer.validated_data.get(
            "is_default", address.is_default
        )

        if make_default:
            Address.objects.filter(user=self.request.user).update(
                is_default=False
            )
            serializer.save(user=self.request.user, is_default=True)
        else:
            serializer.save(user=self.request.user)

    @transaction.atomic
    def perform_destroy(self, instance):
        user = self.request.user
        was_default = instance.is_default
        instance.delete()

        if was_default:
            replacement = (
                Address.objects.filter(user=user)
                .order_by("-created_at")
                .first()
            )
            if replacement:
                replacement.is_default = True
                replacement.save(update_fields=["is_default"])