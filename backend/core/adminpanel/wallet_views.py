from django.contrib.auth import get_user_model
from django.db.models import Sum, Q, Count
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAdminUser

from wallet.models import Wallet, WalletTransaction

User = get_user_model()


class AdminWalletOverviewView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        wallets = Wallet.objects.all()

        total_balance = wallets.aggregate(
            total=Sum("balance")
        )["total"] or 0

        customer_count = wallets.values("user_id").distinct().count()

        credited = WalletTransaction.objects.filter(
            transaction_type="credit"
        ).aggregate(total=Sum("amount"))["total"] or 0

        debited = WalletTransaction.objects.filter(
            transaction_type="debit"
        ).aggregate(total=Sum("amount"))["total"] or 0

        return Response({
            "total_balance": total_balance,
            "customer_count": customer_count,
            "total_credited": credited,
            "total_debited": debited,
        })


class AdminWalletTransactionListView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        transactions = WalletTransaction.objects.select_related(
            "wallet",
            "wallet__user",
        ).order_by("-created_at")

        search = request.query_params.get("search", "").strip()
        transaction_type = request.query_params.get("type", "").strip()

        if search:
            transactions = transactions.filter(
                Q(wallet__user__email__icontains=search)
                | Q(wallet__user__first_name__icontains=search)
                | Q(wallet__user__last_name__icontains=search)
                | Q(reference__icontains=search)
                | Q(description__icontains=search)
            )

        if transaction_type in ("credit", "debit"):
            transactions = transactions.filter(
                transaction_type=transaction_type
            )

        try:
            page = max(int(request.query_params.get("page", 1)), 1)
            page_size = min(
                max(int(request.query_params.get("page_size", 10)), 1),
                100,
            )
        except (TypeError, ValueError):
            return Response(
                {"detail": "Invalid pagination parameters."},
                status=400,
            )

        count = transactions.count()
        start = (page - 1) * page_size

        rows = transactions[start:start + page_size]

        results = []
        for item in rows:
            user = item.wallet.user

            results.append({
                "id": item.pk,
                "customer_name": (
                    user.get_full_name()
                    or user.email
                    or str(user.pk)
                ),
                "email": user.email,
                "transaction_type": item.transaction_type,
                "amount": str(item.amount),
                "description": item.description,
                "reference": item.reference,
                "created_at": item.created_at,
            })

        return Response({
            "count": count,
            "page": page,
            "page_size": page_size,
            "results": results,
        })


class AdminWalletCustomerListView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        wallets = Wallet.objects.select_related("user").order_by("user_id")

        search = request.query_params.get("search", "").strip()
        if search:
            wallets = wallets.filter(
                Q(user__email__icontains=search)
                | Q(user__first_name__icontains=search)
                | Q(user__last_name__icontains=search)
            )

        try:
            page = max(int(request.query_params.get("page", 1)), 1)
            page_size = min(
                max(int(request.query_params.get("page_size", 10)), 1),
                100,
            )
        except (TypeError, ValueError):
            return Response(
                {"detail": "Invalid pagination parameters."},
                status=400,
            )

        count = wallets.count()
        start = (page - 1) * page_size

        results = []
        for wallet in wallets[start:start + page_size]:
            user = wallet.user
            results.append({
                "id": wallet.pk,
                "customer_name": (
                    user.get_full_name()
                    or user.email
                    or str(user.pk)
                ),
                "email": user.email,
                "balance": str(wallet.balance),
            })

        return Response({
            "count": count,
            "page": page,
            "page_size": page_size,
            "results": results,
        })