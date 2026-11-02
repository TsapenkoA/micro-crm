from django.shortcuts import get_object_or_404
from rest_framework.permissions import BasePermission


class IsOwner(BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.owner_id == request.user.pk


def owned_object_or_404(queryset, user, **lookup):
    return get_object_or_404(queryset.filter(owner=user), **lookup)


class OwnerQuerysetMixin:
    def get_queryset(self):
        return super().get_queryset().filter(owner=self.request.user)
