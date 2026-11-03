from django.apps import AppConfig, apps
from django.conf import settings
from django.db.models.signals import post_migrate


class AdminpanelConfig(AppConfig):
    default_auto_field = "django.db.models.AutoField"
    name = "adminpanel"

    def ready(self):
        from .admin_seed import seed_admin_on_migrate

        # after `migrate`, once the user table exists: make sure the admin account from .env exists
        user_app = apps.get_app_config(settings.AUTH_USER_MODEL.split(".")[0])
        post_migrate.connect(seed_admin_on_migrate, sender=user_app, dispatch_uid="adminpanel-seed-admin")