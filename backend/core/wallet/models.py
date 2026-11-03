
from django.conf import settings
from django.db import models


class Wallet(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wallet",
    )
    balance = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customer_wallet"

    def __str__(self):
        return f"Wallet - {self.user}"


class WalletTransaction(models.Model):
    CREDIT = "credit"
    DEBIT = "debit"

    TYPES = [
        (CREDIT, "Credit"),
        (DEBIT, "Debit"),
    ]

    wallet = models.ForeignKey(
        Wallet,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    transaction_type = models.CharField(
        max_length=10,
        choices=TYPES,
    )
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
    )
    description = models.CharField(max_length=255)
    reference = models.CharField(
        max_length=100,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "wallet_transaction"
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.transaction_type} - {self.amount}"
