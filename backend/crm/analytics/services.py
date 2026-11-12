from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Count
from django.utils import timezone
from crm.models import Deal, FxRate, InvoicePayment
from crm.services.calculations import money_string, round_money
from crm.services.fx import common_rate_date, convert


def month_offset(year, month, offset):
    index = year * 12 + month - 1 + offset
    return index // 12, index % 12 + 1


def dashboard_data(workspace_id, currency, period):
    now = timezone.localtime()
    zone = timezone.get_current_timezone()
    if period == "month":
        start_year, start_month = month_offset(now.year, now.month, -11)
        end_year, end_month = month_offset(now.year, now.month, 1)
        labels = [month_offset(start_year, start_month, index) for index in range(12)]
    else:
        current_quarter = (now.month - 1) // 3
        start_year, start_month = month_offset(now.year, current_quarter * 3 + 1, -21)
        end_year, end_month = month_offset(now.year, current_quarter * 3 + 1, 3)
        labels = [month_offset(start_year, start_month, index * 3) for index in range(8)]
    start = timezone.make_aware(datetime(start_year, start_month, 1), zone)
    end = timezone.make_aware(datetime(end_year, end_month, 1), zone)

    deals = Deal.objects.filter(workspace_id=workspace_id, client__workspace_id=workspace_id)
    active = deals.filter(status__in=[Deal.Status.NEW_LEAD, Deal.Status.NEGOTIATION, Deal.Status.IN_PROGRESS])
    active_records = list(active.values("amount", "currency"))
    paid_records = list(deals.filter(status=Deal.Status.PAID).values("amount", "currency", "fx_rate_date"))
    payments = list(InvoicePayment.objects.filter(
        invoice__workspace_id=workspace_id, invoice__client__workspace_id=workspace_id,
        received_on__gte=start.date(), received_on__lt=end.date(),
    ).values("amount", "invoice__currency", "received_on", "fx_rate_date"))

    needs_pipeline_rate = any(row["currency"] != currency for row in active_records)
    pipeline_date = common_rate_date((row["currency"] for row in active_records), currency, now.date()) if needs_pipeline_rate else None
    dates = {row["fx_rate_date"] for row in paid_records if row["currency"] != currency and row["fx_rate_date"]}
    dates.update(row["fx_rate_date"] for row in payments if row["invoice__currency"] != currency and row["fx_rate_date"])
    if pipeline_date:
        dates.add(pipeline_date)
    rates = {(row.date, row.currency): row.per_eur for row in FxRate.objects.filter(date__in=dates)}

    pipeline = Decimal("0")
    pipeline_missing = set()
    for row in active_records:
        value = convert(row["amount"], row["currency"], currency, pipeline_date, rates)
        if value is None:
            pipeline_missing.add(row["currency"])
        else:
            pipeline += value

    paid_total = Decimal("0")
    average_missing = set()
    average_dates = set()
    for row in paid_records:
        value = convert(row["amount"], row["currency"], currency, row["fx_rate_date"], rates)
        if value is None:
            average_missing.add(row["currency"])
        else:
            paid_total += value
            if row["currency"] != currency:
                average_dates.add(row["fx_rate_date"])
    lost_count = deals.filter(status=Deal.Status.ARCHIVED, outcome=Deal.Outcome.LOST).count()
    denominator = len(paid_records) + lost_count
    win_rate = (Decimal(len(paid_records)) * 100 / denominator).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if denominator else None
    average = round_money(paid_total / len(paid_records), currency) if paid_records and not average_missing else None

    amounts = {}
    missing_periods = set()
    revenue_missing = set()
    revenue_dates = set()
    for payment in payments:
        received_on = payment["received_on"]
        bucket = (received_on.year, received_on.month if period == "month" else (received_on.month - 1) // 3 * 3 + 1)
        value = convert(payment["amount"], payment["invoice__currency"], currency, payment["fx_rate_date"], rates)
        if value is None:
            revenue_missing.add(payment["invoice__currency"])
            missing_periods.add(bucket)
        else:
            amounts[bucket] = amounts.get(bucket, Decimal("0")) + value
            if payment["invoice__currency"] != currency:
                revenue_dates.add(payment["fx_rate_date"])
    rows = [{"period": f"{year:04d}-{month:02d}", "revenue": None if (year, month) in missing_periods else money_string(amounts.get((year, month), Decimal("0")), currency)} for year, month in labels]
    revenue = None if revenue_missing else sum(amounts.values(), Decimal("0"))
    stages = list(deals.values("status").annotate(count=Count("id")).order_by("status"))
    recent = list(active.select_related("client").order_by("deadline", "id")[:4].values("id", "title", "client__name", "client__company", "status", "deadline", "amount", "currency"))
    for deal in recent:
        deal["amount"] = f"{deal['amount']:.2f}"
    return {
        "currency": currency,
        "period": period,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "pipeline_value": money_string(pipeline, currency) if not pipeline_missing else None,
        "win_rate": f"{win_rate:.2f}" if win_rate is not None else None,
        "average_deal_size": money_string(average, currency) if average is not None else None,
        "revenue": money_string(revenue, currency) if revenue is not None else None,
        "revenue_rows": rows,
        "deal_counts": stages,
        "recent_deals": recent,
        "fx": {
            "source": "ECB",
            "pipeline_rate_date": pipeline_date.isoformat() if pipeline_date else None,
            "average_rate_dates": sorted(day.isoformat() for day in average_dates),
            "revenue_rate_dates": sorted(day.isoformat() for day in revenue_dates),
            "missing": {
                "pipeline": sorted(pipeline_missing),
                "average_deal_size": sorted(average_missing),
                "revenue": sorted(revenue_missing),
            },
        },
    }
