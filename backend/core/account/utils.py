import hashlib
import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.core.mail import send_mail
from django.utils import timezone

from .models import PasswordOTP


class OTPError(Exception):
    def __init__(self, message, code="invalid"):
        super().__init__(message)
        self.code = code


def split_full_name(full_name):
    """'Minhaj Ahmed Khan' -> ('Minhaj', 'Ahmed Khan'). The form has one name box, the table has two columns."""
    first, _, last = " ".join((full_name or "").split()).partition(" ")
    return first, last


def code_digest(user, purpose, code):
    """What we store in otp_code: a keyed hash of the code, 10 characters, tied to the user and purpose."""
    message = f"{user.pk}:{purpose}:{code}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()[:10]


def _attempts_key(otp):
    return f"otp-attempts:{otp.pk}"


def generate_and_send_otp(user, purpose):
    """Create a fresh 6-digit code, store its digest and email the code to the user."""
    latest = PasswordOTP.objects.filter(user=user, purpose=purpose).first()
    if latest:
        elapsed = (timezone.now() - latest.created_at).total_seconds()
        if elapsed < settings.OTP_RESEND_SECONDS:
            wait = int(settings.OTP_RESEND_SECONDS - elapsed) + 1
            raise OTPError(f"Please wait {wait} seconds before requesting a new code.", "cooldown")

    # old codes stop working as soon as a new one is issued
    PasswordOTP.objects.filter(user=user, purpose=purpose, is_used=False).update(is_used=True)

    code = f"{secrets.randbelow(1_000_000):06d}"
    PasswordOTP.objects.create(
        user=user,
        purpose=purpose,
        otp_code=code_digest(user, purpose, code),
        expires_at=timezone.now() + timedelta(minutes=settings.OTP_EXPIRY_MINUTES),
    )

    if purpose == PasswordOTP.SIGNUP:
        subject = "Verify your Aurevo account"
        intro = "Use this code to verify your email address."
    else:
        subject = "Reset your Aurevo password"
        intro = "Use this code to reset your password."
    message = (
        f"Hi {user.first_name or 'there'},\n\n{intro}\n\n"
        f"    {code}\n\n"
        f"The code expires in {settings.OTP_EXPIRY_MINUTES} minutes. "
        "If you didn't request it, you can ignore this email."
    )
    send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False)


def verify_otp(user, purpose, code, consume=True):
    """Check a code. Raises OTPError if it can't be accepted."""
    otp = PasswordOTP.objects.filter(user=user, purpose=purpose, is_used=False).first()
    if not otp:
        raise OTPError("No active code. Request a new one.", "no_code")
    if otp.is_expired():
        raise OTPError("This code has expired. Request a new one.", "expired")

    # The diagram has no "attempts" column, so wrong guesses are counted in Django's cache.
    # Use a shared cache (Redis) in production so every server process sees the same count.
    key = _attempts_key(otp)
    if cache.get(key, 0) >= settings.OTP_MAX_ATTEMPTS:
        raise OTPError("Too many wrong attempts. Request a new code.", "locked")

    if not hmac.compare_digest(otp.otp_code, code_digest(user, purpose, code)):
        timeout = settings.OTP_EXPIRY_MINUTES * 60 + 60
        cache.add(key, 0, timeout)
        try:
            cache.incr(key)
        except ValueError:  # the entry expired between add and incr
            cache.set(key, 1, timeout)
        raise OTPError("Incorrect code.", "invalid")

    if consume:
        otp.is_used = True
        otp.save(update_fields=["is_used"])
    return otp