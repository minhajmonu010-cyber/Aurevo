from pathlib import Path
import os
from datetime import timedelta
import sys
from urllib.parse import parse_qs, unquote, urlsplit
from dotenv import load_dotenv
from django.core.exceptions import ImproperlyConfigured

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent.parent
for dotenv_path in (
    PROJECT_ROOT / ".env.local",
    PROJECT_ROOT / ".env",
    BASE_DIR / ".env",
):
    load_dotenv(dotenv_path)

TESTING=len(sys.argv)>1 and sys.argv[1]=='test'
ADMIN_EMAIL=os.getenv("ADMIN_EMAIL","").strip()
ADMIN_PASSWORD=os.getenv("ADMIN_PASSWORD","")
ADMIN_FIRST_NAME=os.getenv("ADMIN_FIRST_NAME","Admin")

# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/6.1/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = 'django-insecure-1fg$89$%#6nbc*d(#*t%+y)%xj!vkaki%%j+^3wnw55qqr6)i+'

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = False if os.getenv("DEBUG", "False").strip().lower() in {"0", "false", "no", "off"} else True

ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'rest_framework_simplejwt.token_blacklist',
    'account',
    'catalog',
    'orders',
    'storefront',
    'contact',
    'wallet',
    'adminpanel',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'core.wsgi.application'


# Database
# https://docs.djangoproject.com/en/6.1/ref/settings/#databases

DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL:
    parsed_database_url = urlsplit(DATABASE_URL)
    if (
        parsed_database_url.scheme not in {"postgres", "postgresql"}
        or not parsed_database_url.hostname
        or not parsed_database_url.path.strip("/")
    ):
        raise ImproperlyConfigured("DATABASE_URL must be a PostgreSQL connection URL.")

    database_options = {
        key: values[-1]
        for key, values in parse_qs(parsed_database_url.query).items()
    }
    database_options.setdefault("sslmode", "require")
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": unquote(parsed_database_url.path.lstrip("/")),
            "USER": unquote(parsed_database_url.username or ""),
            "PASSWORD": unquote(parsed_database_url.password or ""),
            "HOST": parsed_database_url.hostname,
            "PORT": parsed_database_url.port or 5432,
            "OPTIONS": database_options,
            "CONN_MAX_AGE": 60,
            "CONN_HEALTH_CHECKS": True,
            "DISABLE_SERVER_SIDE_CURSORS": True,
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.getenv('DB_NAME'),
            'USER': os.getenv('DB_USER'),
            'PASSWORD': os.getenv('DB_PASSWORD'),
            'HOST': os.getenv('DB_HOST'),
            'PORT': os.getenv('DB_PORT'),
            'CONN_HEALTH_CHECKS': True,
        }
    }


# Password validation
# https://docs.djangoproject.com/en/6.1/ref/settings/#auth-password-validators

AUTH_USER_MODEL = 'account.User'

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/6.1/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'Asia/Kolkata'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.1/howto/static-files/

STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'


REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_THROTTLE_CLASSES': (
        'rest_framework.throttling.ScopedRateThrottle',
    ),
    'DEFAULT_THROTTLE_RATES': {"auth": "30/minute",'admin_auth':"10/min"},
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=30),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
}

CORS_ALLOWED_ORIGINS=[
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:3000",
]

CORS_ALLOW_CREDENTIALS=True

AUTHENTICATION_BACKENDS={
    'django.contrib.auth.backends.ModelBackend',
}

EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT") or "587")
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "True") == "True"
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "Aurevo <no-reply@aurevo.local>")
EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "")

OTP_EXPIRY_MINUTES=2
OTP_MAX_ATTEMPTS=5
OTP_RESEND_SECONDS=30
REQUIRE_EMAIL_VERIFICATION = os.getenv("REQUIRE_EMAIL_VERIFICATION", "true").strip().lower() not in {"0", "false", "no", "off"}

GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID', "")
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "").strip()

# Email
# https://docs.djangoproject.com/en/6.1/topics/email/#topic-email-configuration

LOGIN_RIDERECT_PROVIDERS='/callback/'

SOCIALACCOUNT_PROVIDERS={
    'google':{
        'SCOPE':['email','profile'],
        'AUTH_PARAMS':{'access_type':'online'},
        'OAUTH_PCKE_ENABLED':True,
        'FETCH_USERINFO':True,
    }
}

SOCIALACCOUNT_STORE_TOKENS=True

MEDIA_URL="media/"
MEDIA_ROOT=BASE_DIR / "media"