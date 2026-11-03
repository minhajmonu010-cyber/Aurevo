from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0003_checkout_payment_gateway"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="return_reason",
            field=models.TextField(blank=True, default=""),
        ),
    ]
