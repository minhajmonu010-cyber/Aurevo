from django.shortcuts import render

# Create your views here.
from decimal import Decimal

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Product, ProductVariant
from .serializers import CartItemWriteSerializer, CartQuantitySerializer, WishlistItemWriteSerializer
from .models import CartItem, WishlistItem


def image_url(product, request):
    image = product.images.first()
    return request.build_absolute_uri(image.image.url) if image else None


def cart_data(item, request):
    variant = item.variant
    product = variant.product
    original_price = variant.original_price or variant.price
    return {
        "id": item.id,
        "variant_id": variant.id,
        "product_id": product.id,
        "name": product.name,
        "slug": product.slug,
        "image": image_url(product, request),
        "size": variant.size,
        "color": variant.color,
        "price": str(variant.price),
        "original_price": str(original_price),
        "quantity": item.quantity,
        "stock": variant.stock,
        "line_total": str(variant.price * item.quantity),
        "original_line_total": str(original_price * item.quantity),
    }


def wishlist_data(item, request):
    product = item.product
    variant = (
        ProductVariant.objects.filter(product=product, is_active=True)
        .order_by("price", "id")
        .first()
    )
    return {
        "id": item.id,
        "product_id": product.id,
        "name": product.name,
        "slug": product.slug,
        "image": image_url(product, request),
        "price": str(variant.price) if variant else None,
        "in_stock": bool(variant and variant.stock > 0),
    }


class CartView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        items = (
            CartItem.objects.filter(user=request.user)
            .select_related("variant", "variant__product")
            .prefetch_related("variant__product__images")
        )
        rows = [cart_data(item, request) for item in items]
        subtotal = sum(
            (Decimal(row["line_total"]) for row in rows),
            Decimal("0.00"),
        )
        original_subtotal = sum(
            (Decimal(row["original_line_total"]) for row in rows),
            Decimal("0.00"),
        )
        return Response({
            "items": rows,
            "count": sum(row["quantity"] for row in rows),
            "subtotal": str(subtotal),
            "original_subtotal": str(original_subtotal),
            "discount_total": str(original_subtotal - subtotal),
        })

    @transaction.atomic
    def post(self, request):
        serializer = CartItemWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        variant_id = serializer.validated_data["variant_id"]
        quantity = serializer.validated_data["quantity"]

        variant = get_object_or_404(
            ProductVariant.objects.select_for_update().select_related(
                "product",
                "product__category",
            ),
            pk=variant_id,
            is_active=True,
            product__is_active=True,
            product__category__is_active=True,
        )

        item = CartItem.objects.filter(
            user=request.user,
            variant=variant,
        ).first()
        new_quantity = quantity + (item.quantity if item else 0)

        if new_quantity > variant.stock:
            return Response(
                {"quantity": [f"Only {variant.stock} are currently available."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if item:
            item.quantity = new_quantity
            item.save(update_fields=["quantity", "updated_at"])
        else:
            item = CartItem.objects.create(
                user=request.user,
                variant=variant,
                quantity=quantity,
            )

        return Response(
            cart_data(item, request),
            status=status.HTTP_201_CREATED,
        )


class CartItemView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        item = get_object_or_404(
            CartItem.objects.select_related("variant", "variant__product"),
            pk=pk,
            user=request.user,
        )

        serializer = CartQuantitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        quantity = serializer.validated_data["quantity"]
        if quantity > item.variant.stock:
            return Response(
                {"quantity": [f"Only {item.variant.stock} are currently available."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        item.quantity = quantity
        item.save(update_fields=["quantity", "updated_at"])
        return Response(cart_data(item, request))

    def delete(self, request, pk):
        item = get_object_or_404(CartItem, pk=pk, user=request.user)
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WishlistView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        items = (
            WishlistItem.objects.filter(
                user=request.user,
                product__is_active=True,
                product__category__is_active=True,
            )
            .select_related("product")
            .prefetch_related("product__images")
        )
        return Response({
            "items": [wishlist_data(item, request) for item in items]
        })

    def post(self, request):
        serializer = WishlistItemWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product_id = serializer.validated_data["product_id"]

        product = get_object_or_404(
            Product.objects.select_related("category"),
            pk=product_id,
            is_active=True,
            category__is_active=True,
        )
        item, created = WishlistItem.objects.get_or_create(
            user=request.user,
            product=product,
        )
        return Response(
            wishlist_data(item, request),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class WishlistItemView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        item = get_object_or_404(
            WishlistItem,
            pk=pk,
            user=request.user,
        )
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)