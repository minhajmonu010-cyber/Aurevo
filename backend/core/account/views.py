import logging
import uuid
from django.core.files.storage import default_storage
from django.db import IntegrityError,transaction
from rest_framework.parsers import FormParser,JSONParser,MultiPartParser
from smtplib import SMTPException
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import update_last_login
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from google.auth.transport import requests as google_requests
from google.auth.exceptions import TransportError
from google.oauth2 import id_token as google_id_token
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from .models import PasswordOTP
from .serializers import (
    ChangePasswordSerializer,
    EmailOnlySerializer,
    GoogleLoginSerializer,
    LoginSerializer,
    OTPPurposeSerializer,
    ResetPasswordSerializer,
    SignupSerializer,
    UserSerializer,
    VerifyOTPSerializer,
    ALLOWED_IMAGE_TYPES,
    ProfileUpdateSerializer,
    RefreshTokenSerializer,
)
from .utils import OTPError, generate_and_send_otp, split_full_name, verify_otp

logger = logging.getLogger(__name__)
User = get_user_model()


# ---------- helpers ----------
def otp_error_response(err):
    code = status.HTTP_429_TOO_MANY_REQUESTS if err.code == "cooldown" else status.HTTP_400_BAD_REQUEST
    return Response({"detail": str(err), "code": err.code}, status=code)


def send_code(user, purpose):
    """Send an OTP. Returns None on success, or a Response describing the failure."""
    try:
        generate_and_send_otp(user, purpose)
    except OTPError as err:
        return otp_error_response(err)
    except (SMTPException, OSError):
        logger.exception("Could not send OTP email")
        return Response(
            {"detail": "We couldn't send the email. Try again in a moment.", "code": "email_failed"},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return None


def tokens_for(user):
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def revoke_all_refresh_tokens(user):
    """Log the user out everywhere (used after a password change or reset)."""
    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)


class PublicView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


# ---------- views ----------
class SignupView(PublicView):
    def post(self, request):
        serializer = SignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = User.objects.filter(email__iexact=data["email"]).first()
        if user and user.is_verified:
            return Response(
                {"email": ["An account with this email already exists."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        first_name, last_name = split_full_name(data["full_name"])
        with transaction.atomic():
            if user:  # signed up before but never verified: let them start over
                user.first_name = first_name
                user.last_name = last_name
                user.set_password(data["password"])
                user.save()
            else:
                user = User.objects.create_user(
                    email=data["email"],
                    password=data["password"],
                    first_name=first_name,
                    last_name=last_name,
                )

        if settings.REQUIRE_EMAIL_VERIFICATION:
            failure = send_code(user, PasswordOTP.SIGNUP)
            if failure:
                return failure
        else:
            user.is_verified = True
            user.save(update_fields=["is_verified"])

        return Response(
            {
                "detail": "We sent a 6-digit code to your email."
                if settings.REQUIRE_EMAIL_VERIFICATION
                else "Account created.",
                "email": user.email,
                "verification_required": settings.REQUIRE_EMAIL_VERIFICATION,
            },
            status=status.HTTP_201_CREATED,
        )


class VerifyOTPView(PublicView):
    """Signup: marks the email as verified. Reset: only checks the code (it is consumed on reset)."""

    def post(self, request):
        serializer = VerifyOTPSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = User.objects.filter(email__iexact=data["email"]).first()
        if not user:
            return Response({"detail": "Incorrect code.", "code": "invalid"}, status=400)

        purpose = data["purpose"]
        try:
            verify_otp(user, purpose, data["otp"], consume=(purpose == PasswordOTP.SIGNUP))
        except OTPError as err:
            return otp_error_response(err)

        if purpose == PasswordOTP.SIGNUP:
            user.is_verified = True
            user.save(update_fields=["is_verified"])
        return Response({"detail": "Code verified."})


class ResendOTPView(PublicView):
    def post(self, request):
        serializer = OTPPurposeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = User.objects.filter(email__iexact=data["email"]).first()
        eligible = user and (data["purpose"] == PasswordOTP.RESET or not user.is_verified)
        if eligible:
            failure = send_code(user, data["purpose"])
            if failure:
                return failure
        # same answer whether or not the account exists
        return Response({"detail": "If the account exists, a new code is on its way."})


class LoginView(PublicView):
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = authenticate(request, email=data["email"], password=data["password"])
        if user is None:
            return Response(
                {"detail": "Incorrect email or password.", "code": "invalid_credentials"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        update_last_login(None, user)
        return Response({**tokens_for(user), "user": UserSerializer(user).data})


class GoogleLoginView(PublicView):
    """Sign in or sign up with a Google ID token (the `credential` from Google's button)."""

    def post(self, request):
        serializer = GoogleLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if not settings.GOOGLE_CLIENT_ID:
            return Response(
                {"detail": "Google login isn't set up yet.", "code": "google_not_configured"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:  # checks signature, expiry, issuer and that the token was made for OUR client id
            claims = google_id_token.verify_oauth2_token(
                serializer.validated_data["credential"],
                google_requests.Request(),
                settings.GOOGLE_CLIENT_ID,
                clock_skew_in_seconds=10,
            )
        except TransportError:
            logger.warning("Google token verification service is unavailable", exc_info=True)
            return Response(
                {
                    "detail": "Google sign-in is temporarily unavailable. Please try again.",
                    "code": "google_verification_unavailable",
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except ValueError as exc:
            logger.warning("Google ID token was rejected: %s", exc)
            return Response(
                {"detail": "Google sign-in failed. Please try again.", "code": "google_invalid"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        email = (claims.get("email") or "").strip().lower()
        if not email or not claims.get("email_verified"):
            return Response(
                {"detail": "Your Google email isn't verified.", "code": "google_email_unverified"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            first_name = (claims.get("given_name") or "").strip()
            last_name = (claims.get("family_name") or "").strip()
            if not first_name:
                first_name, last_name = split_full_name(claims.get("name") or email.split("@")[0])
            picture = claims.get("picture") or ""
            user = User(
                email=email,
                first_name=first_name[:50],
                last_name=last_name[:50],
                profile_image=picture if 0 < len(picture) <= 255 else None,
                is_verified=True,
            )
            user.set_unusable_password()  # no password until they use "forgot password"
            user.save()
        else:
            if not user.is_active:
                return Response(
                    {"detail": "This account is disabled.", "code": "account_disabled"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if not user.is_verified:
                # Someone may have signed up with this email without owning it. Google has now
                # proven the real owner, so verify the account and throw away that password.
                user.set_unusable_password()
                user.is_verified = True
                user.save(update_fields=["password", "is_verified"])

        return Response({**tokens_for(user), "user": UserSerializer(user).data})


class LogoutView(PublicView):
    def post(self, request):
        serializer = RefreshTokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            RefreshToken(serializer.validated_data["refresh"]).blacklist()
        except TokenError:
            pass  # already expired or invalid: nothing left to revoke
        return Response(status=status.HTTP_205_RESET_CONTENT)


class ForgotPasswordView(PublicView):
    def post(self, request):
        serializer = EmailOnlySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = User.objects.filter(email__iexact=serializer.validated_data["email"], is_verified=True).first()
        if user:
            try:
                generate_and_send_otp(user, PasswordOTP.RESET)
            except (OTPError, SMTPException, OSError):
                logger.warning("Could not send reset OTP", exc_info=True)
        # same answer whether or not the account exists
        return Response({"detail": "If that email has an account, we sent a code."})


class ResetPasswordView(PublicView):
    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = User.objects.filter(email__iexact=data["email"], is_verified=True).first()
        if not user:
            return Response({"detail": "Incorrect code.", "code": "invalid"}, status=400)

        try:  # check the password first so a weak password doesn't burn the code
            validate_password(data["new_password"], user)
        except DjangoValidationError as err:
            return Response({"new_password": list(err.messages)}, status=400)

        try:
            verify_otp(user, PasswordOTP.RESET, data["otp"], consume=True)
        except OTPError as err:
            return otp_error_response(err)

        user.set_password(data["new_password"])
        user.save(update_fields=["password"])
        revoke_all_refresh_tokens(user)
        return Response({"detail": "Password updated."})


class ChangePasswordView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = request.user

        if not user.check_password(data["current_password"]):
            return Response({"current_password": ["Current password is incorrect."]}, status=400)
        try:
            validate_password(data["new_password"], user)
        except DjangoValidationError as err:
            return Response({"new_password": list(err.messages)}, status=400)

        user.set_password(data["new_password"])
        user.save(update_fields=["password"])
        revoke_all_refresh_tokens(user)  # other devices are signed out
        return Response({"detail": "Password updated.", **tokens_for(user)})  # this device stays in

def delete_stored_image(path):
    if path and path.startswith("profile_images/"):
        try:
            default_storage.delete(path)
        except OSError:
            logger.warning("Could not delete %s", path, exc_info=True)


class MeView(APIView):
    """GET: the signed-in user. PATCH: edit name, phone and profile picture."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]  # multipart is needed for the picture upload

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        serializer = ProfileUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = request.user
        changed = []

        if "full_name" in data:
            user.first_name, user.last_name = split_full_name(data["full_name"])
            changed += ["first_name", "last_name"]

        phone_taken = Response({"phone": ["This phone number is already in use."]}, status=400)
        if "phone" in data:
            phone = data["phone"] or None
            if phone and User.objects.filter(phone=phone).exclude(pk=user.pk).exists():
                return phone_taken
            user.phone = phone
            changed.append("phone")

        old_image = user.profile_image
        new_path = None
        picture = data.get("profile_image")
        if picture:
            extension = ALLOWED_IMAGE_TYPES[picture.content_type]
            new_path = default_storage.save(f"profile_images/{user.pk}/{uuid.uuid4().hex}{extension}", picture)
            user.profile_image = new_path
            changed.append("profile_image")
        elif data.get("remove_profile_image"):
            user.profile_image = None
            changed.append("profile_image")

        if changed:
            try:
                user.save(update_fields=changed + ["updated_at"])
            except IntegrityError:
                delete_stored_image(new_path)
                return phone_taken
            if "profile_image" in changed:
                delete_stored_image(old_image)

        return Response(UserSerializer(user).data)
