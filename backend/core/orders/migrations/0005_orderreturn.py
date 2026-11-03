from django.db import migrations, models
import django.db.models.deletion


def backfill_return_requests(apps, schema_editor):
    Order = apps.get_model("orders", "Order")
    OrderReturn = apps.get_model("orders", "OrderReturn")
    database = schema_editor.connection.alias

    for order in Order.objects.using(database).filter(order_status="returned").iterator():
        OrderReturn.objects.using(database).get_or_create(
            order_id=order.pk,
            defaults={
                "reason": order.return_reason,
                "refund_amount": order.total_amount,
            },
        )


class Migration(migrations.Migration):
    dependencies = [
        ("orders", "0004_order_return_reason"),
    ]

    operations = [
        migrations.CreateModel(
            name="OrderReturn",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("reason", models.TextField()),
                ("status", models.CharField(choices=[("requested", "Requested"), ("approved", "Approved"), ("rejected", "Rejected")], default="requested", max_length=20)),
                ("refund_amount", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("order", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="return_request", to="orders.order")),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.RunPython(backfill_return_requests, migrations.RunPython.noop),
    ]