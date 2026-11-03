from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from adminpanel.admin_seed import check_settings, ensure_admin


class Command(BaseCommand):
    help = "Create or repair the admin account from ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset-password",
            action="store_true",
            help="Set the password to ADMIN_PASSWORD even if the admin already exists.",
        )
        parser.add_argument(
            "--promote",
            action="store_true",
            help="Turn an existing customer account with this email into the admin (its password is replaced).",
        )

    def handle(self, *args, **options):
        problem = check_settings()
        if problem:
            raise CommandError(problem)
        try:
            result = ensure_admin(
                settings.ADMIN_EMAIL,
                settings.ADMIN_PASSWORD,
                first_name=settings.ADMIN_FIRST_NAME,
                reset_password=options["reset_password"],
                promote=options["promote"],
            )
        except ValidationError as err:
            raise CommandError("ADMIN_PASSWORD is too weak: " + " ".join(err.messages))

        email = settings.ADMIN_EMAIL.strip().lower()
        if result == "blocked":
            raise CommandError(
                f"A customer account already uses {email}. Run again with --promote to make it the admin "
                "(its password will be replaced)."
            )
        messages = {
            "created": f"Admin account created: {email}",
            "updated": f"Admin account updated: {email}",
            "unchanged": f"Admin account already exists: {email} (nothing changed; use --reset-password to set the password again)",
        }
        self.stdout.write(self.style.SUCCESS(messages[result]))