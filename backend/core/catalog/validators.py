from PIL import Image, UnidentifiedImageError
from rest_framework import serializers

MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}

def check_image(value):
    if not value:
        return value

    if value.size > MAX_IMAGE_BYTES:
        raise serializers.ValidationError("Use JPG, PNG or WebP pictures up to 5 MB.")

    try:
        image = Image.open(value)
        if image.format not in ALLOWED_IMAGE_FORMATS:
            raise serializers.ValidationError("Use a JPG, PNG or WebP picture.")
        image.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as err:
        raise serializers.ValidationError("Upload a valid image file.") from err
    finally:
        value.seek(0)

    return value