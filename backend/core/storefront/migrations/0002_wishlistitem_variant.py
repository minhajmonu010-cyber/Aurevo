import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0001_initial"),
        ("storefront", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="wishlistitem",
            name="variant",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="wishlist_items",
                to="catalog.productvariant",
            ),
        ),
    ]
