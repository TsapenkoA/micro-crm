from django.shortcuts import get_object_or_404
from rest_framework import serializers


class StrictModelSerializer(serializers.ModelSerializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            writable = {name for name, field in self.fields.items() if not field.read_only}
            forbidden = set(data) - writable
            if forbidden:
                raise serializers.ValidationError({field: "This field is not writable." for field in sorted(forbidden)})
        return super().to_internal_value(data)


class WorkspaceClientField(serializers.PrimaryKeyRelatedField):
    def to_internal_value(self, value):
        pk = serializers.UUIDField().run_validation(value)
        return get_object_or_404(self.get_queryset(), pk=pk)


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError({field: "This field is not writable." for field in sorted(unknown)})
        return super().to_internal_value(data)
