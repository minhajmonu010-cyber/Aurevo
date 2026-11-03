# adminpanel/return_views.py

from django.db import transaction
from django.db.models import Count, F, Q
from rest_framework import serializers, status
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.inventory import restore_order_stock
from orders.models import OrderReturn
from wallet.models import Wallet, WalletTransaction


class AdminReturnSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(
        source="order.order_number",
        read_only=True,
    )
    customer_name = serializers.SerializerMethodField()
    customer_email = serializers.SerializerMethodField()

    class Meta:
        model = OrderReturn
        fields = [
            "id",
            "order",
            "order_number",
            "customer_name",
            "customer_email",
            "reason",
            "status",
            "refund_amount",
            "created_at",
        ]
        read_only_fields = fields

    def get_customer_name(self, obj):
        user = getattr(obj.order, "user", None)

        if not user:
            return "Customer"

        return user.get_full_name().strip() or getattr(
            user, "email", "Customer"
        )

    def get_customer_email(self, obj):
        user = getattr(obj.order, "user", None)
        return getattr(user, "email", "") if user else ""


class AdminReturnStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=(OrderReturn.APPROVED, OrderReturn.REJECTED))


class AdminReturnListView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        returns = OrderReturn.objects.select_related(
            "order",
            "order__user",
        ).all().order_by("-created_at")

        search = request.query_params.get("search", "").strip()
        return_status = request.query_params.get("status", "").strip()

        if search:
            returns = returns.filter(
                Q(order__order_number__icontains=search)
                | Q(order__user__email__icontains=search)
                | Q(reason__icontains=search)
            )

        if return_status:
            valid_statuses = {
                choice[0]
                for choice in OrderReturn._meta
                .get_field("status").choices
            }

            if return_status not in valid_statuses:
                return Response(
                    {"detail": "Invalid return status."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            returns = returns.filter(status=return_status)

        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except (ValueError, TypeError):
            page = 1

        page_size = 20
        total = returns.count()
        start = (page - 1) * page_size
        page_returns = returns[start:start + page_size]
        summary = OrderReturn.objects.aggregate(
            total=Count("id"),
            requested=Count("id", filter=Q(status=OrderReturn.REQUESTED)),
            approved=Count("id", filter=Q(status=OrderReturn.APPROVED)),
            rejected=Count("id", filter=Q(status=OrderReturn.REJECTED)),
        )

        return Response({
            "count": total,
            "page": page,
            "page_size": page_size,
            "summary": summary,
            "results": AdminReturnSerializer(
                page_returns,
                many=True,
            ).data,
        })


class AdminReturnStatusView(APIView):
    permission_classes = [IsAdminUser]

    @transaction.atomic
    def patch(self, request, return_id):
        try:
            return_request = OrderReturn.objects.select_for_update().get(pk=return_id)
        except OrderReturn.DoesNotExist:
            return Response(
                {"detail": "Return request not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = AdminReturnStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data["status"]

        if new_status == OrderReturn.APPROVED and not return_request.order.user_id:
            return Response(
                {"detail": "Cannot credit the wallet because the customer account no longer exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if return_request.status != "requested":
            return Response(
                {
                    "detail": (
                        "Only requested returns can be approved "
                        "or rejected."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        wallet_balance = None
        if new_status == OrderReturn.APPROVED:
            restore_order_stock(
                return_request.order,
                note=f"Restocked approved return for order {return_request.order.order_number}",
            )

        if new_status == OrderReturn.APPROVED and return_request.refund_amount > 0:
            wallet, _ = Wallet.objects.get_or_create(user_id=return_request.order.user_id)
            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
            wallet.balance = F("balance") + return_request.refund_amount
            wallet.save(update_fields=["balance", "updated_at"])
            WalletTransaction.objects.create(
                wallet=wallet,
                transaction_type=WalletTransaction.CREDIT,
                amount=return_request.refund_amount,
                description=f"Refund for return {return_request.order.order_number}",
                reference=f"return:{return_request.pk}",
            )
            wallet.refresh_from_db(fields=["balance"])
            wallet_balance = str(wallet.balance)

        return_request.status = new_status
        return_request.save(update_fields=["status"])

        return Response({
            "message": "Return request status updated.",
            "id": return_request.id,
            "status": return_request.status,
            "wallet_credit": str(return_request.refund_amount) if new_status == OrderReturn.APPROVED else None,
            "wallet_balance": wallet_balance,
        })