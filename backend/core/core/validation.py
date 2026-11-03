import re
from decimal import Decimal

from rest_framework import serializers


class StrictIntegerField(serializers.IntegerField):
    def to_internal_value(self, data):
        if isinstance(data, bool) or not isinstance(data, (int, str)):
            self.fail("invalid")
        if isinstance(data, str) and not re.fullmatch(r"[+-]?\d+", data.strip()):
            self.fail("invalid")
        return super().to_internal_value(data)


class StrictDecimalField(serializers.DecimalField):
    def to_internal_value(self, data):
        if isinstance(data, bool) or not isinstance(data, (str, int, float, Decimal)):
            self.fail("invalid")
        return super().to_internal_value(data)


class StrictBooleanField(serializers.BooleanField):
    def to_internal_value(self, data):
        if not isinstance(data, bool):
            self.fail("invalid")
        return data


class StrictPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    def to_internal_value(self, data):
        if isinstance(data, bool) or not isinstance(data, (int, str)):
            self.fail("incorrect_type", data_type=type(data).__name__)
        if isinstance(data, str) and not re.fullmatch(r"\d+", data.strip()):
            self.fail("incorrect_type", data_type=type(data).__name__)
        return super().to_internal_value(data)
