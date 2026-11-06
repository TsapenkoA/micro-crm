from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Count, Sum
from django.db.models.functions import TruncMonth, TruncQuarter
from django.utils import timezone
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.deals.models import Deal
from apps.invoices.calculations import CURRENCY_PLACES, money_string
from apps.invoices.models import Invoice
from common.permissions import IsWorkspaceMember


class DashboardFilters(serializers.Serializer):
    currency = serializers.ChoiceField(choices=tuple(CURRENCY_PLACES), default="USD")
    period = serializers.ChoiceField(choices=("month", "quarter"), default="month")


def month_offset(year, month, offset):
    index = year * 12 + month - 1 + offset
    return index // 12, index % 12 + 1


class Dashboard(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get(self, request):
        filters = DashboardFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        currency = filters.validated_data["currency"]
        period = filters.validated_data["period"]
        now = timezone.localtime()
        zone = timezone.get_current_timezone()
        if period == "month":
            start_year, start_month = month_offset(now.year, now.month, -11)
            end_year, end_month = month_offset(now.year, now.month, 1)
            labels = [month_offset(start_year, start_month, index) for index in range(12)]
            truncation = TruncMonth("paid_at", tzinfo=zone)
        else:
            current_quarter = (now.month - 1) // 3
            start_year, start_month = month_offset(now.year, current_quarter * 3 + 1, -21)
            end_year, end_month = month_offset(now.year, current_quarter * 3 + 1, 3)
            labels = [month_offset(start_year, start_month, index * 3) for index in range(8)]
            truncation = TruncQuarter("paid_at", tzinfo=zone)
        start = timezone.make_aware(datetime(start_year, start_month, 1), zone)
        end = timezone.make_aware(datetime(end_year, end_month, 1), zone)

        deals = Deal.objects.filter(workspace_id=request.workspace_id, client__workspace_id=request.workspace_id, currency=currency)
        active = deals.filter(status__in=[Deal.Status.NEW_LEAD, Deal.Status.NEGOTIATION, Deal.Status.IN_PROGRESS])
        pipeline = active.aggregate(amount=Sum("amount"))["amount"] or Decimal("0")
        paid_deals = deals.filter(status=Deal.Status.PAID)
        paid = paid_deals.aggregate(count=Count("id"), amount=Sum("amount"))
        lost_count = deals.filter(status=Deal.Status.ARCHIVED, outcome=Deal.Outcome.LOST).count()
        denominator = paid["count"] + lost_count
        win_rate = (Decimal(paid["count"]) * 100 / denominator).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if denominator else None
        average = ((paid["amount"] or Decimal("0")) / paid["count"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if paid["count"] else None

        invoices = Invoice.objects.filter(workspace_id=request.workspace_id, currency=currency, status=Invoice.Status.PAID, paid_at__gte=start, paid_at__lt=end)
        grouped = invoices.annotate(bucket=truncation).values("bucket").annotate(amount=Sum("total_amount")).order_by("bucket")
        amounts = {(row["bucket"].year, row["bucket"].month): row["amount"] for row in grouped}
        rows = [{"period": f"{year:04d}-{month:02d}", "revenue": money_string(amounts.get((year, month), Decimal("0")), currency)} for year, month in labels]
        revenue = sum(amounts.values(), Decimal("0"))
        stages = list(deals.values("status").annotate(count=Count("id")).order_by("status"))
        recent = list(active.select_related("client").order_by("deadline", "id")[:4].values("id", "title", "client__name", "client__company", "status", "deadline", "amount"))
        for deal in recent:
            deal["amount"] = f"{deal['amount']:.2f}"
        return Response({
            "currency": currency,
            "period": period,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "pipeline_value": f"{pipeline:.2f}",
            "win_rate": f"{win_rate:.2f}" if win_rate is not None else None,
            "average_deal_size": f"{average:.2f}" if average is not None else None,
            "revenue": money_string(revenue, currency),
            "revenue_rows": rows,
            "deal_counts": stages,
            "recent_deals": recent,
        })
