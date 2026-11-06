from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0008_orderitem_cancellation"),
    ]

    operations = [
        migrations.AddField(
            model_name="payment",
            name="refunded_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name="payment",
            name="refund_id",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AlterField(
            model_name="payment",
            name="payment_status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("paid", "Paid"),
                    ("failed", "Failed"),
                    ("refund_pending", "Refund pending"),
                    ("refunded", "Refunded"),
                ],
                default="pending",
                max_length=50,
            ),
        ),
    ]
