from django.contrib import admin
from .models import Order, OrderItem, Payment,OrderStatusHistory

# Register your models here.
admin.site.register(Order)
admin.site.register(OrderItem)
admin.site.register(Payment)
admin.site.register(OrderStatusHistory)