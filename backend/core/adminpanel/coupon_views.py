from django.db.models import F, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAdminUser

from .models import Coupon
from .coupon_serializers import AdminCouponSerializer


class AdminCouponListCreateView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        coupons = Coupon.objects.all()
        now = timezone.now()
        active_now = Coupon.objects.filter(
            is_active=True,
            start_date__lte=now,
            end_date__gte=now,
        )
        summary = {
            "total": Coupon.objects.count(),
            "active": active_now.filter(
                Q(usage_limit__isnull=True) | Q(used_count__lt=F("usage_limit"))
            ).count(),
            "scheduled": Coupon.objects.filter(is_active=True, start_date__gt=now).count(),
            "expired": Coupon.objects.filter(is_active=True, end_date__lt=now).count(),
            "inactive": Coupon.objects.filter(is_active=False).count(),
            "used_up": active_now.filter(
                usage_limit__isnull=False,
                used_count__gte=F("usage_limit"),
            ).count(),
        }

        search = request.query_params.get("search", "").strip()
        coupon_status = request.query_params.get("status", "").strip()

        if search:
            coupons = coupons.filter(
                Q(code__icontains=search)
                | Q(description__icontains=search)
            )

        serializer = AdminCouponSerializer(coupons, many=True)
        data = serializer.data

        if coupon_status:
            data = [
                coupon for coupon in data
                if coupon["status"].lower() == coupon_status.lower()
            ]

        try:
            page = max(int(request.query_params.get("page", 1)), 1)
            page_size = min(
                max(int(request.query_params.get("page_size", 10)), 1),
                100,
            )
        except (TypeError, ValueError):
            return Response(
                {"detail": "Invalid pagination parameters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        total = len(data)
        start = (page - 1) * page_size

        return Response({
            "count": total,
            "page": page,
            "page_size": page_size,
            "summary": summary,
            "results": data[start:start + page_size],
        })

    def post(self, request):
        serializer = AdminCouponSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(
            serializer.data,
            status=status.HTTP_201_CREATED,
        )


class AdminCouponDetailView(APIView):
    permission_classes = [IsAdminUser]

    def get_object(self, coupon_id):
        return get_object_or_404(Coupon, pk=coupon_id)

    def patch(self, request, coupon_id):
        coupon = self.get_object(coupon_id)
        serializer = AdminCouponSerializer(
            coupon,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(serializer.data)

    def delete(self, request, coupon_id):
        coupon = self.get_object(coupon_id)
        coupon.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)