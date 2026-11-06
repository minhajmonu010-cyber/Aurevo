from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0010_payment_pending_refund_amount"),
    ]

    operations = [
        migrations.AlterField(
            model_name="orderreturn",
            name="order",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="return_requests",
                to="orders.order",
            ),
        ),
        migrations.AddField(
            model_name="orderreturn",
            name="item",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="return_requests",
                to="orders.orderitem",
            ),
        ),
    ]
