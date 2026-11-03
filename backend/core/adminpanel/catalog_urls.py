from rest_framework.routers import DefaultRouter

from .catalog_views import (
    AdminBrandViewSet,
    AdminCategoryViewSet,
    AdminImageViewSet,
    AdminProductViewSet,
    AdminVariantViewSet,
)

router = DefaultRouter()
router.register("categories", AdminCategoryViewSet, basename="admin-category")
router.register("brands", AdminBrandViewSet, basename="admin-brand")
router.register("products", AdminProductViewSet, basename="admin-product")
router.register("variants", AdminVariantViewSet, basename="admin-variant")
router.register("images", AdminImageViewSet, basename="admin-image")

urlpatterns = router.urls