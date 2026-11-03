from django.db import models
from django.contrib.auth.models import AbstractUser
from django.contrib.auth.models import BaseUserManager
from django.utils import timezone

# Create your models here.

class UserManager(BaseUserManager):
    use_in_migrations = True
    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError('Email is required')
        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', False)
        extra_fields.setdefault('is_superuser', False)

        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('is_verified', True)
        return self._create_user(email, password, **extra_fields)

class User(AbstractUser):
    username = None
    date_joined = None
    first_name = models.CharField(max_length=50)
    last_name = models.CharField(max_length=50, blank=True)
    email = models.EmailField(max_length=100, unique=True)
    phone= models.CharField(max_length=20,unique=True, null=True)
    profile_image = models.CharField(max_length=255, blank=True, null=True)
    password = models.CharField(max_length=255,db_column='password_hash')
    is_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ["first_name", "last_name"]

    objects = UserManager()

    class Meta:
        db_table='user'

    @property
    def full_name(self):
        return self.get_full_name()    

    def __str__(self):
        return self.email

class PasswordOTP(models.Model):
    SIGNUP = 'signup'
    RESET='reset'
    PURPOSE = [(SIGNUP, 'Signup'), (RESET, 'Password reset')]

    otp_code=models.CharField(max_length=10)
    purpose=models.CharField(max_length=50,choices=PURPOSE)
    expires_at=models.DateTimeField()
    is_used=models.BooleanField(default=False)
    created_at=models.DateTimeField(auto_now_add=True)
    user=models.ForeignKey(User,on_delete=models.CASCADE,related_name='otps')

    class Meta:
        db_table='password_otp'
        ordering=['-created_at']

    def is_expired(self):
        return timezone.now()>= self.expires_at

    def __str__(self):
        return f"{self.user.email}-{self.purpose}"

from django.conf import settings
from django.db import models


class Address(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="addresses",
    )
    full_name = models.CharField(max_length=150)
    phone = models.CharField(max_length=20)
    address_line1 = models.CharField(max_length=255)
    address_line2 = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100)
    district = models.CharField(max_length=100, blank=True, default="")
    state = models.CharField(max_length=100)
    postal_code = models.CharField(max_length=12)
    country = models.CharField(max_length=100, default="India")
    address_type = models.CharField(
        max_length=20,
        choices=[
            ("home", "Home"),
            ("work", "Work"),
            ("company","Company"),
            ("other", "Other"),
        ],
        default="home",
    )
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_default", "-created_at"]

    def __str__(self):
        return f"{self.full_name} - {self.city}"