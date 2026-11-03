import io
import random
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from PIL import Image, ImageDraw

from catalog.models import Brand, Category, InventoryLog, Product, ProductImage, ProductVariant
from orders.models import Order, OrderItem, OrderStatusHistory, Payment

DEMO_DOMAIN = "@demo.example.com"
CATEGORIES = [  # name, description, featured
    ("Streetwear", "Loose, bold pieces made to stand out.", True),
    ("Oversized", "Drop-shoulder fits with a heavy drape.", True),
    ("Old Money", "Timeless tailoring in the quiet style of old money.", True),
    ("Casual", "Everyday shirts and tees.", False),
    ("Formal", "Sharp shirts for work and occasions.", False),
    ("Linen", "Light, breathable summer pieces.", False),
]
PRODUCTS = [  # name, category, price, old price, cost, collection
    ("Heavyweight Boxy Graphic Tee", "Streetwear", 1899, 2499, 700, "Drop 04 - Cyber Acid"),
    ("Raw Hem Distressed Longsleeve", "Streetwear", 2299, None, 900, "Drop 04 - Cyber Acid"),
    ("Cyber Cargo Pant", "Streetwear", 3499, 4299, 1400, "Drop 03 - Night Shift"),
    ("Oversized Drop Shoulder Tee", "Oversized", 1499, 1999, 550, "Core"),
    ("Washed Oversized Hoodie", "Oversized", 3299, None, 1300, "Core"),
    ("Architectural Modular Overshirt", "Old Money", 4599, 5499, 1900, "FW 24"),
    ("Pleated Relaxed Trouser", "Old Money", 3999, None, 1600, "FW 24"),
    ("Cashmere Ribbed Polo", "Old Money", 5299, 6299, 2300, "FW 24"),
    ("Everyday Cotton Shirt", "Casual", 1799, None, 650, "Core"),
    ("Striped Camp Collar Shirt", "Casual", 1999, 2599, 760, "SS 25"),
    ("Slim Fit Oxford Shirt", "Formal", 2499, None, 950, "Core"),
    ("Tailored Poplin Shirt", "Formal", 2899, 3499, 1100, "Core"),
    ("Linen Resort Shirt", "Linen", 2699, 3199, 1000, "SS 25"),
    ("Linen Drawstring Pant", "Linen", 2399, None, 880, "SS 25"),
]
BRANDS = ["Aurevo", "Oblivion Archives", "Studio North"]
SIZES = ["S", "M", "L", "XL"]
COLORS = ["Black", "Off-White", "Olive", "Navy"]
FIRST = ["Julian", "Elena", "Soren", "Marcus", "Mei-Ling", "Aarav", "Priya", "Noah", "Zara", "Liam", "Isha", "Kabir"]
LAST = ["Vance", "Rostova", "Lindqvist", "Sterling", "Zhou", "Nair", "Menon", "Fischer", "Khan", "Murphy", "Rao", "Das"]


def picture(label, seed, name="demo.jpg", size=(480, 600)):
    """A plain coloured picture with a letter on it, so the lists show thumbnails."""
    rnd = random.Random(seed)
    top, bottom = [rnd.randint(30, 120) for _ in range(3)], [rnd.randint(10, 60) for _ in range(3)]
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    for y in range(size[1]):
        mix = y / size[1]
        draw.line([(0, y), (size[0], y)], fill=tuple(int(top[i] * (1 - mix) + bottom[i] * mix) for i in range(3)))
    draw.text((size[0] // 2 - 8, size[1] // 2 - 8), label[:1].upper(), fill=(235, 235, 245))
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=80)
    return ContentFile(buffer.getvalue(), name=name)


class Command(BaseCommand):
    help = "Create (or remove with --clear) demo categories, products, customers and orders for the admin screens."

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="Remove the demo data.")
        parser.add_argument("--force", action="store_true", help="Run even when DEBUG is False.")

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError("seed_demo is for development. DEBUG is False, so nothing was done.")
        with transaction.atomic():
            self.clear()
            if options["clear"]:
                self.stdout.write(self.style.SUCCESS("Demo data removed."))
                return
            self.create()

    def clear(self):
        User = get_user_model()
        Order.objects.filter(user__email__endswith=DEMO_DOMAIN).delete()
        for product in Product.objects.filter(sku__startswith="DEMO-"):
            for image in product.images.all():
                image.image.delete(save=False)
            product.delete()
        User.objects.filter(email__endswith=DEMO_DOMAIN).delete()
        for category in Category.objects.filter(name__in=[c[0] for c in CATEGORIES], is_system=False, products__isnull=True):
            if category.image:
                category.image.delete(save=False)
            category.delete()

    def create(self):
        User, rnd, now = get_user_model(), random.Random(42), timezone.now()

        brands = {name: Brand.objects.get_or_create(name=name)[0] for name in BRANDS}
        categories = {}
        for index, (name, description, featured) in enumerate(CATEGORIES, start=1):
            category, created = Category.objects.get_or_create(
                name=name, defaults={"description": description, "is_featured": featured, "priority": index}
            )
            if created:
                category.image.save(f"demo-cat-{category.slug}.jpg", picture(name, index), save=True)
            categories[name] = category

        variants = []
        for index, (name, category, price, old, cost, collection) in enumerate(PRODUCTS, start=1):
            product = Product.objects.create(
                name=name, category=categories[category], brand=brands[BRANDS[index % len(BRANDS)]],
                sku=f"DEMO-{index:03d}", collection=collection, cost_price=Decimal(cost), is_featured=index % 4 == 1,
                description=f"{name}: a demo product so the admin screens have something to show.",
                low_stock_threshold=10,
            )
            ProductImage.objects.create(
                product=product, is_primary=True, image=picture(name, 100 + index, name=f"demo-{index:03d}.jpg")
            )
            for size in SIZES:
                for color in rnd.sample(COLORS, 2):
                    stock = rnd.choice([0, 3, 9, 18, 22, 26, 30, 35, 40, 45, 60, 80, 100, 120])  # about one in five is low
                    variant = ProductVariant.objects.create(
                        product=product, size=size, color=color, sku=f"{product.sku}-{size}-{color}".upper().replace(" ", "-"),
                        price=Decimal(price), original_price=Decimal(old) if old else None, stock=stock,
                    )
                    if stock:
                        InventoryLog.objects.create(variant=variant, type=InventoryLog.IN, quantity=stock, note="Initial stock")
                    variants.append(variant)

        customers = []
        for index, (first, last) in enumerate(zip(FIRST, LAST), start=1):
            user = User.objects.create_user(
                email=f"{first.lower()}.{last.lower()}{DEMO_DOMAIN}", password=None, first_name=first, last_name=last, is_verified=True
            )
            User.objects.filter(pk=user.pk).update(created_at=now - timedelta(days=rnd.randint(1, 75)))
            customers.append(user)

        mix = ["delivered"] * 10 + ["shipped"] * 4 + ["processing"] * 3 + ["returned"] + ["cancelled"]
        for _ in range(48):
            status = rnd.choice(mix)
            when = now - timedelta(days=rnd.choice([0, 0, 1, 1, 2, 3, 4, 5, 6, 8, 12, 20, 28, 35, 45, 55]), minutes=rnd.randint(0, 900))
            lines = rnd.sample(variants, rnd.randint(1, 3))
            order = Order.objects.create(
                user=rnd.choice(customers), total_amount=Decimal(0), order_status=status,
                payment_method=rnd.choice(["UPI", "Card", "Net banking"]), shipping_charge=Decimal(0),
            )
            total = Decimal(0)
            for variant in lines:
                quantity = rnd.randint(1, 2)
                line_total = variant.price * quantity
                total += line_total
                OrderItem.objects.create(
                    order=order, variant=variant, category=variant.product.category, product_name=variant.product.name,
                    sku=variant.sku, size=variant.size, color=variant.color, quantity=quantity,
                    price=variant.price, total_price=line_total,
                )
            Order.objects.filter(pk=order.pk).update(total_amount=total, created_at=when)
            payment_status = {"returned": Payment.REFUNDED, "cancelled": Payment.FAILED}.get(status, Payment.PAID)
            Payment.objects.create(
                order=order, payment_method=order.payment_method, amount=total, payment_status=payment_status,
                transaction_id=f"DEMO-TXN-{order.pk:05d}", paid_at=when + timedelta(minutes=2) if payment_status != Payment.FAILED else None,
            )
            Payment.objects.filter(order=order).update(created_at=when)
            for step in ["pending", "processing", "shipped", "delivered"][: ["pending", "processing", "shipped", "delivered"].index(status) + 1] if status in ("processing", "shipped", "delivered") else ["pending", status]:
                OrderStatusHistory.objects.create(order=order, status=step)

        self.stdout.write(self.style.SUCCESS(
            f"Demo data created: {len(CATEGORIES)} categories, {len(PRODUCTS)} products, {len(variants)} variants, "
            f"{len(customers)} customers, 48 orders. Remove it with: python manage.py seed_demo --clear"
        ))
