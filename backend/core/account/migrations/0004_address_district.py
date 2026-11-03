from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("account", "0003_address"),
    ]

    operations = [
        migrations.AddField(
            model_name="address",
            name="district",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
    ]