import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("adminpanel", "0001_initial"),
        ("orders", "0006_orderitem_product_image"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="coupon",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="orders", to="adminpanel.coupon"),
        ),
        migrations.AddField(
            model_name="order",
            name="coupon_code",
            field=models.CharField(blank=True, default="", max_length=50),
        ),
    ]