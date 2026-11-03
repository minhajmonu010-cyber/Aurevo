from rest_framework import generics
from rest_framework.permissions import AllowAny
from rest_framework.throttling import AnonRateThrottle

from .models import ContactMessage
from .serializers import ContactMessageSerializer


class ContactMessageThrottle(AnonRateThrottle):
    rate = "5/hour"


class ContactMessageCreateView(generics.CreateAPIView):
    queryset = ContactMessage.objects.all()
    serializer_class = ContactMessageSerializer
    permission_classes = [AllowAny]
    throttle_classes = [ContactMessageThrottle]