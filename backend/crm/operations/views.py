from datetime import timedelta

from django.db.models import Case, CharField, DateTimeField, F, Value, When
from django.db.models.functions import Cast, TruncDate
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from crm.api.pagination import ClientPagination
from crm.api.permissions import IsWorkspaceMember
from crm.models import Deal, Invoice, Task


def due_rows(queryset, kind, due_field, title, subtitle, now, today):
    return queryset.order_by().annotate(
        kind=Value(kind, output_field=CharField()),
        title_value=F(title),
        subtitle=F(subtitle) if isinstance(subtitle, str) else subtitle,
        due_time=Cast(due_field, DateTimeField()),
        due_day=F(due_field) if kind == "invoice" else TruncDate(due_field),
        overdue=Case(When(**{f"{due_field}__lt": today if kind == "invoice" else now}, then=Value(True)), default=Value(False)),
    ).values("id", "kind", "title_value", "subtitle", "due_time", "due_day", "overdue")


def due_page(queryset, offset, page_size, count):
    if offset >= count:
        return []
    rows = queryset.order_by("-overdue", "due_day", "kind", "id")[offset:offset + page_size]
    return [{
        "kind": row["kind"], "id": str(row["id"]), "title": row["title_value"],
        "subtitle": row["subtitle"], "overdue": row["overdue"],
        "due_at": row["due_day"].isoformat() if row["kind"] == "invoice" else row["due_time"].isoformat(),
    } for row in rows]


class OperationsOverview(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get(self, request):
        try:
            page = int(request.query_params.get("page", "1"))
            undated_page = int(request.query_params.get("undated_page", "1"))
        except ValueError as exc:
            raise ValidationError({"page": "Enter a positive page number."}) from exc
        if page < 1 or undated_page < 1:
            raise ValidationError({"page": "Enter a positive page number."})
        page_size = ClientPagination.page_size
        offset = (page - 1) * page_size
        undated_offset = (undated_page - 1) * page_size
        now = timezone.now()
        today = timezone.localdate()
        task_cutoff = now + timedelta(days=7)
        date_cutoff = today + timedelta(days=7)
        tasks = Task.objects.filter(
            workspace_id=request.workspace_id, assignee=request.user,
            status=Task.Status.OPEN, due_at__lte=task_cutoff,
        ).select_related("client", "deal")
        deals = Deal.objects.filter(
            workspace_id=request.workspace_id, client__workspace_id=request.workspace_id,
            status__in=[Deal.Status.NEW_LEAD, Deal.Status.NEGOTIATION, Deal.Status.IN_PROGRESS],
            deadline__lte=task_cutoff,
        ).select_related("client")
        invoices = Invoice.objects.filter(
            workspace_id=request.workspace_id, client__workspace_id=request.workspace_id,
            status=Invoice.Status.SENT, due_date__lte=date_cutoff,
        ).select_related("client")
        undated = Invoice.objects.filter(
            workspace_id=request.workspace_id, client__workspace_id=request.workspace_id,
            status=Invoice.Status.SENT, due_date__isnull=True,
        ).select_related("client").order_by("created_at", "id")

        task_subtitle = Case(When(deal__isnull=True, then=F("client__name")), default=F("deal__title"))
        task_rows = due_rows(tasks, "task", "due_at", "title", task_subtitle, now, today)
        deal_rows = due_rows(deals, "deal", "deadline", "title", "client__name", now, today)
        invoice_rows = due_rows(invoices, "invoice", "due_date", "invoice_number", "client__name", now, today)
        reminders = deal_rows.union(invoice_rows, all=True)
        today_rows = task_rows.union(deal_rows, invoice_rows, all=True)
        today_count, reminder_count, undated_count = today_rows.count(), reminders.count(), undated.count()
        undated_rows = undated[undated_offset:undated_offset + page_size] if undated_offset < undated_count else []
        return Response({
            "today": {"count": today_count, "results": due_page(today_rows, offset, page_size, today_count)},
            "reminders": {"count": reminder_count, "results": due_page(reminders, offset, page_size, reminder_count)},
            "undated_invoices": {"count": undated_count, "results": [
                {"id": str(invoice.pk), "invoice_number": invoice.invoice_number, "client_name": invoice.client.name}
                for invoice in undated_rows
            ]},
        })
