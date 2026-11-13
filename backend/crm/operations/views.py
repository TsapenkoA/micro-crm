from datetime import datetime, timedelta

from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from crm.api.permissions import IsWorkspaceMember
from crm.models import Deal, Invoice, Task


def due_item(kind, record, due, title, subtitle, now, today):
    return {
        "kind": kind,
        "id": str(record.pk),
        "title": title,
        "subtitle": subtitle,
        "due_at": due.isoformat(),
        "overdue": due < now if isinstance(due, datetime) else due < today,
    }


class OperationsOverview(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get(self, request):
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

        task_items = [due_item("task", task, task.due_at, task.title,
                               task.deal.title if task.deal else task.client.name, now, today) for task in tasks]
        deal_items = [due_item("deal", deal, deal.deadline, deal.title, deal.client.name, now, today) for deal in deals]
        invoice_items = [due_item("invoice", invoice, invoice.due_date, invoice.invoice_number,
                                  invoice.client.name, now, today) for invoice in invoices]
        by_due = lambda item: (item["due_at"][:10], item["kind"], item["id"])
        reminders = sorted(deal_items + invoice_items, key=by_due)
        today_items = sorted(task_items + reminders, key=by_due)
        return Response({
            "today": {"count": len(today_items), "results": today_items[:20]},
            "reminders": {"count": len(reminders), "results": reminders[:20]},
        })
