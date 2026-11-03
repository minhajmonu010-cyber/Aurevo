from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .serializers import AdminLoginSerializer, AdminRefreshTokenSerializer, AdminUserSerializer


def tokens_for(user):
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


class AdminPublicView(APIView):
    """Admin endpoints that need no token. Limited to 10 requests a minute (see settings: admin_auth)."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "admin_auth"


class AdminLoginView(AdminPublicView):
    """
    Email + password. Only staff (is_staff=True) get tokens. Admin accounts are created from
    ADMIN_EMAIL / ADMIN_PASSWORD (see admin_seed.py); there is no admin signup.
    """

    def post(self, request):
        serializer = AdminLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = authenticate(request, email=data["email"], password=data["password"])
        if user is None:  # wrong email, wrong password or disabled account: one message for all
            return Response(
                {"detail": "Incorrect email or password.", "code": "invalid_credentials"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if not user.is_staff:
            return Response(
                {"detail": "This account doesn't have admin access.", "code": "not_admin"},
                status=status.HTTP_403_FORBIDDEN,
            )

        update_last_login(None, user)
        return Response({**tokens_for(user), "user": AdminUserSerializer(user).data})


class AdminLogoutView(AdminPublicView):
    """Cancels the refresh token so it can never be used again."""

    def post(self, request):
        serializer = AdminRefreshTokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            RefreshToken(serializer.validated_data["refresh"]).blacklist()
        except TokenError:
            pass  # already expired or invalid: nothing left to cancel
        return Response(status=status.HTTP_205_RESET_CONTENT)


class AdminMeView(APIView):
    """Current admin. The admin app also calls it to check that a saved session is still an admin."""

    permission_classes = [IsAdminUser]  # 401 if not signed in, 403 if signed in but not staff

    def get(self, request):
        return Response(AdminUserSerializer(request.user).data)

    def patch(self, request):
        serializer = AdminUserSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)