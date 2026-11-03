from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAdminUser
from rest_framework import status
from django.utils import timezone
from .models import Offer
from .offer_serializers import AdminOfferSerializer


class AdminOfferListCreateView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        offers = Offer.objects.all()

        search = request.query_params.get("search", "").strip()
        selected_status = request.query_params.get("status", "").strip()

        if search:
            offers = offers.filter(
                Q(name__icontains=search)
                | Q(description__icontains=search)
            )

        # Compute status filters against the serialized status field.
        serializer = AdminOfferSerializer(offers, many=True)
        data = list(serializer.data)

        if selected_status:
            data = [
                item for item in data
                if item["status"].lower() == selected_status.lower()
            ]

        try:
            page = max(int(request.query_params.get("page", 1)), 1)
            page_size = min(
                max(int(request.query_params.get("page_size", 10)), 1),
                100,
            )
        except (ValueError, TypeError):
            return Response(
                {"detail": "Invalid pagination parameters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        count = len(data)
        start = (page - 1) * page_size

        return Response({
            "count": count,
            "page": page,
            "page_size": page_size,
            "results": data[start:start + page_size],
        })

    def post(self, request):
        serializer = AdminOfferSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            serializer.data,
            status=status.HTTP_201_CREATED,
        )


class AdminOfferDetailView(APIView):
    permission_classes = [IsAdminUser]

    def get_object(self, offer_id):
        return get_object_or_404(Offer, pk=offer_id)

    def patch(self, request, offer_id):
        offer = self.get_object(offer_id)
        serializer = AdminOfferSerializer(
            offer,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, offer_id):
        offer = self.get_object(offer_id)
        offer.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)