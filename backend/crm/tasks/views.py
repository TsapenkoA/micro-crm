from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import generics
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from crm.api.pagination import ClientPagination
from crm.api.permissions import IsWorkspaceMember, WorkspaceQuerysetMixin
from crm.activity.services import log_activity, snapshot
from crm.models import Task, WorkspaceMembership
from crm.tasks.serializers import TaskSerializer


class TaskQuerysetMixin(WorkspaceQuerysetMixin):
    queryset = Task.objects.all()
    permission_classes = [IsWorkspaceMember]
    serializer_class = TaskSerializer

    def get_queryset(self):
        return super().get_queryset().select_related("client", "deal", "assignee").order_by("due_at", "id")

    def lock_membership(self):
        if not WorkspaceMembership.objects.select_for_update().filter(user=self.request.user, workspace_id=self.request.workspace_id).exists():
            raise PermissionDenied("Workspace membership has changed. Please retry the request.")


class TaskList(TaskQuerysetMixin, generics.ListCreateAPIView):
    pagination_class = ClientPagination

    def get_queryset(self):
        queryset = super().get_queryset()
        search = self.request.query_params.get("search", "").strip()
        if len(search) > 200:
            raise ValidationError({"search": "Search is too long."})
        if search:
            queryset = queryset.filter(Q(title__icontains=search) | Q(client__name__icontains=search) | Q(deal__title__icontains=search))
        for field in ("client", "deal"):
            value = self.request.query_params.get(field)
            if value:
                queryset = queryset.filter(**{f"{field}_id": serializers.UUIDField().run_validation(value)})
        mine = self.request.query_params.get("mine")
        if mine not in (None, "1"):
            raise ValidationError({"mine": "Use 1 to show your tasks."})
        if mine:
            queryset = queryset.filter(assignee=self.request.user)
        status = self.request.query_params.get("status")
        if status not in (None, *Task.Status.values):
            raise ValidationError({"status": "Choose open or done."})
        if status:
            queryset = queryset.filter(status=status)
        due = self.request.query_params.get("due")
        if due == "overdue":
            queryset = queryset.filter(status=Task.Status.OPEN, due_at__lt=timezone.now())
        elif due == "upcoming":
            queryset = queryset.filter(status=Task.Status.OPEN, due_at__gte=timezone.now())
        elif due is not None:
            raise ValidationError({"due": "Choose overdue or upcoming."})
        return queryset

    @transaction.atomic
    def perform_create(self, serializer):
        self.lock_membership()
        task = serializer.save(workspace_id=self.request.workspace_id, created_by=self.request.user,
                               assignee=serializer.validated_data.get("assignee", self.request.user))
        log_activity(task, self.request.user, "created")


class TaskDetail(TaskQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    http_method_names = ["get", "patch", "delete", "head", "options"]

    @transaction.atomic
    def perform_update(self, serializer):
        self.lock_membership()
        before = snapshot(serializer.instance)
        status = serializer.validated_data.get("status", serializer.instance.status)
        completed_at = timezone.now() if status == Task.Status.DONE and serializer.instance.status != Task.Status.DONE else None if status == Task.Status.OPEN else serializer.instance.completed_at
        task = serializer.save(completed_at=completed_at)
        log_activity(task, self.request.user, "updated", before)

    @transaction.atomic
    def perform_destroy(self, instance):
        self.lock_membership()
        log_activity(instance, self.request.user, "deleted")
        instance.delete()
