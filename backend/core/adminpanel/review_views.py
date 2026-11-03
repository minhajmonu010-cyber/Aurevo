from django.db.models import Avg
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    permission_classes,
)
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from catalog.models import Review
from .review_serializers import AdminReviewApprovalSerializer, AdminReviewSerializer


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_reviews(request):
    reviews = Review.objects.select_related(
        "user", "product"
    ).all().order_by("-created_at")

    review_status = request.query_params.get("status")
    rating = request.query_params.get("rating")
    search = request.query_params.get("search")

    if review_status == "approved":
        reviews = reviews.filter(is_approved=True)
    elif review_status == "pending":
        reviews = reviews.filter(is_approved=False)

    if rating:
        if rating not in {"1", "2", "3", "4", "5"}:
            return Response(
                {"error": "Rating must be between 1 and 5."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reviews = reviews.filter(rating=int(rating))

    if search:
        from django.db.models import Q

        reviews = reviews.filter(
            Q(comment__icontains=search)
            | Q(user__username__icontains=search)
            | Q(product__name__icontains=search)
        )

    data = AdminReviewSerializer(
        reviews, many=True
    ).data

    return Response({
        "total": Review.objects.count(),
        "approved": Review.objects.filter(
            is_approved=True
        ).count(),
        "pending": Review.objects.filter(
            is_approved=False
        ).count(),
        "average_rating": Review.objects.aggregate(
            average=Avg("rating")
        )["average"] or 0,
        "results": data,
    })


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAdminUser])
def admin_review_detail(request, review_id):
    try:
        review = Review.objects.get(id=review_id)
    except Review.DoesNotExist:
        return Response(
            {"error": "Review not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    if request.method == "PATCH":
        serializer = AdminReviewApprovalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        approved = serializer.validated_data["is_approved"]

        review.is_approved = approved
        review.save(update_fields=["is_approved"])

        return Response({
            "message": (
                "Review approved."
                if approved else "Review hidden."
            ),
            "id": review.id,
            "is_approved": review.is_approved,
        })

    review.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)