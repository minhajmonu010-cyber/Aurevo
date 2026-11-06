import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("adminpanel", "0002_offer"),
    ]

    operations = [
        migrations.AddField(
            model_name="coupon",
            name="max_discount_amount",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=10,
                null=True,
                validators=[django.core.validators.MinValueValidator(0.01)],
            ),
        ),
    ]
