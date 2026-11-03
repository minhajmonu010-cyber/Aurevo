from django.utils.text import slugify


def unique_slug(model, value, max_length=150, instance_pk=None):
    """
    Generate a unique slug for a model using the given value.
    Example: Premium Shirt -> premium-shirt
    """
    base_slug = slugify(value)[:max_length].strip("-")
    slug = base_slug
    counter = 1

    queryset = model.objects.all()

    if instance_pk:
        queryset = queryset.exclude(pk=instance_pk)

    while queryset.filter(slug=slug).exists():
        suffix = f"-{counter}"
        slug = f"{base_slug[:max_length - len(suffix)]}{suffix}"
        counter += 1

    return slug