from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("orders", "0005_orderreturn"),
    ]

    operations = [
        migrations.AddField(
            model_name="orderitem",
            name="product_image",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
    ]