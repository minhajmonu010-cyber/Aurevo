from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import DEFAULT_DB_ALIAS, connections

# The password written in .env.example. It is fine on your own computer, never on a live site.
EXAMPLE_PASSWORD = "Aurevo@Admin2026"

def ensure_admin(email, password, first_name="Admin", last_name="", reset_password=False, promote=False):
    """
    Returns "created", "updated", "unchanged" or "blocked".
    Raises ValidationError if the password is too weak.
    """
    User = get_user_model()
    email = email.strip().lower()
    validate_password(password)  # at least 8 characters, not a common password, not only digits

    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        User.objects.create_user(
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
            is_staff=True,
            is_superuser=False,
            is_verified=True,
        )
        return "created"

    if not user.is_staff and not promote:
        # A customer already signed up with this email. Never turn a customer into an admin by accident.
        return "blocked"

    changed = False
    if not user.is_staff:
        user.is_staff = True
        reset_password = True  # we cannot trust the customer's old password for an admin account
        changed = True
    if not user.is_active:
        user.is_active = True
        changed = True
    if not user.is_verified:
        user.is_verified = True
        changed = True
    if reset_password:
        user.set_password(password)
        changed = True
    if changed:
        user.save()
        return "updated"
    return "unchanged"


def check_settings():
    """Returns an error message if the admin settings can't be used, else None."""
    if not settings.ADMIN_EMAIL or not settings.ADMIN_PASSWORD:
        return "Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env."
    if not settings.DEBUG and settings.ADMIN_PASSWORD == EXAMPLE_PASSWORD:
        return "ADMIN_PASSWORD is still the example password from .env.example. Choose your own before going live."
    return None


def seed_admin_on_migrate(sender=None, using=DEFAULT_DB_ALIAS, **kwargs):
    """Runs after every `migrate`. Creates the admin if it does not exist yet; never changes an existing one."""
    if settings.TESTING or not settings.ADMIN_EMAIL or not settings.ADMIN_PASSWORD:
        return
    if get_user_model()._meta.db_table not in connections[using].introspection.table_names():
        return  # the user table is not there yet

    problem = check_settings()
    if problem:
        print(f"Admin account not created: {problem}")
        return
    try:
        result = ensure_admin(
            settings.ADMIN_EMAIL,
            settings.ADMIN_PASSWORD,
            first_name=settings.ADMIN_FIRST_NAME,
        )
    except ValidationError as err:
        print(f"Admin account not created: {' '.join(err.messages)}")
        return

    if result == "created":
        print(f"Admin account created: {settings.ADMIN_EMAIL.strip().lower()}")
    elif result == "blocked":
        print(
            f"Admin account not created: a customer account already uses {settings.ADMIN_EMAIL}. "
            "Run `python manage.py seed_admin --promote` to turn it into the admin (its password is replaced)."
        )