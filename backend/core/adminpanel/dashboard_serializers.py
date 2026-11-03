from rest_framework import serializers

from orders.models import Order


class DashboardOrderSerializer(serializers.ModelSerializer):
    """One row of the Recent Orders table."""

    customer = serializers.SerializerMethodField()
    amount = serializers.DecimalField(source="total_amount", max_digits=10, decimal_places=2, read_only=True)
    payment_status = serializers.SerializerMethodField()
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = ("id", "order_number", "customer", "created_at", "amount", "payment_status", "order_status", "items_count")

    def get_customer(self, obj):
        user = obj.user
        if not user:
            return {"name": "Deleted customer", "email": "", "initials": "?"}
        name = user.full_name or user.email
        initials = "".join(part[0] for part in name.split()[:2]).upper() or "?"
        return {"name": name, "email": user.email, "initials": initials}

    def get_payment_status(self, obj):
        return obj.latest_payment_status or "pending"

    def get_items_count(self, obj):
        return sum(item.quantity for item in obj.items.all())

