from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0009_payment_refund_tracking"),
    ]

    operations = [
        migrations.AddField(
            model_name="payment",
            name="pending_refund_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
    ]
