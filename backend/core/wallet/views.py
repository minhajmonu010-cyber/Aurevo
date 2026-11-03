from django.db import transaction
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from .models import Wallet
from .serializers import WalletSerializer


class MyWalletView(generics.RetrieveAPIView):
    serializer_class = WalletSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        with transaction.atomic():
            wallet, _ = Wallet.objects.get_or_create(
                user=self.request.user
            )
        return wallet