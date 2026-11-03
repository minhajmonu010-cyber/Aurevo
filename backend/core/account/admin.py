from django.contrib import admin
from .models import User, PasswordOTP

# Register your models here.

@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display=("email","first_name","last_name","phone","is_verified","is_staff","is_active")
    list_filter=("is_verified","is_staff","is_active")
    search_fields=("email","first_name","last_name",'phone')
    ordering=("-created_at",)
    readonly_fields=("password","created_at","updated_at","last_login")
    fields=("email","first_name","last_name","phone","is_verified","is_staff","is_active","password","created_at","updated_at","last_login",'is_superuser')

@admin.register(PasswordOTP)
class PasswordOTPAdmin(admin.ModelAdmin):
    list_display=("user","purpose","created_at","expires_at","is_used")
    list_filter=("purpose","is_used")
