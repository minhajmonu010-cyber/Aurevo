from django.contrib import admin
from .models import Brand,ProductImage,ProductVariant,InventoryLog,Product,Category

admin.site.register(Brand)

admin.site.register(ProductImage)

admin.site.register(ProductVariant)

admin.site.register(InventoryLog)

admin.site.register(Product)
admin.site.register(Category)


