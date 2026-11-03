from django.contrib import admin
from django.urls import include, path
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('django-admin/', admin.site.urls),
    path('api/auth/', include('account.urls')),
    path('api/catalog/', include('catalog.urls')),
    path('api/contact/', include('contact.urls')),
    path('api/admin/auth/', include('adminpanel.urls')),
    path("api/addresses/", include("account.address_urls")),
    path("api/orders/", include("orders.urls")),
    path("api/wallet/", include("wallet.urls")),
    path('api/admin/dashboard/', include('adminpanel.dashboard_urls')),
    path('api/admin/catalog/', include('adminpanel.catalog_urls')),
    path("api/shop/", include("storefront.urls")),

]

if settings.DEBUG:
    urlpatterns+= static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)