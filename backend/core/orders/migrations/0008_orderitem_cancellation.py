from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0007_order_coupon"),
    ]

    operations = [
        migrations.AddField(
            model_name="orderitem",
            name="is_cancelled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="orderitem",
            name="cancelled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="coupon_discount_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
    ]
