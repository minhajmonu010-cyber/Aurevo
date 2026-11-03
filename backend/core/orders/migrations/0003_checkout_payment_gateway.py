from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0002_order_shipping_address"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="checkout_from_cart",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="payment",
            name="gateway_order_id",
            field=models.CharField(blank=True, default="", max_length=50),
        ),
    ]