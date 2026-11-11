from datetime import UTC, datetime, timedelta
from pathlib import Path

from django.conf import settings
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from crm.api.permissions import IsWorkspaceMember
from crm.models import BackupCheck, Deal, FxRate, FxSyncRun, Invoice, Workspace
from crm.services.fx import ECB_CURRENCIES


def latest_stored_archive():
    if not settings.BACKUP_DIRECTORY:
        return None
    try:
        directory = Path(settings.BACKUP_DIRECTORY).resolve()
        if directory.is_relative_to(settings.BASE_DIR.parent.resolve()) or not directory.is_dir():
            return None
        files = (path for path in directory.glob("microflow-*.dump") if path.is_file() and not path.is_symlink())
        newest = max(files, key=lambda path: path.stat().st_mtime, default=None)
        return datetime.fromtimestamp(newest.stat().st_mtime, UTC) if newest else None
    except OSError:
        return None


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsWorkspaceMember])
def operations_status(request):
    workspace = get_object_or_404(Workspace, pk=request.workspace_id)
    if workspace.owner_id != request.user.pk:
        raise PermissionDenied("Only the workspace owner can view operations status.")

    latest_run = FxSyncRun.objects.order_by("-started_at", "-pk").first()
    complete_date = (
        FxRate.objects.filter(currency__in=ECB_CURRENCIES)
        .values("date")
        .annotate(currency_count=Count("currency"))
        .filter(currency_count=len(ECB_CURRENCIES))
        .order_by("-date")
        .values_list("date", flat=True)
        .first()
    )
    missing_paid = sum(
        model.objects.filter(status="paid", paid_at__isnull=False, fx_rate_date__isnull=True).count()
        for model in (Deal, Invoice)
    )
    healthy = bool(
        latest_run and latest_run.status == FxSyncRun.Status.SUCCESS
        and latest_run.finished_at and latest_run.finished_at >= timezone.now() - timedelta(days=2)
        and complete_date and complete_date >= timezone.localdate() - timedelta(days=4)
        and not missing_paid
    )
    backup = BackupCheck.objects.order_by("-verified_at", "-pk").first()
    smtp = (settings.EMAIL_BACKEND == "django.core.mail.backends.smtp.EmailBackend"
            and bool(settings.EMAIL_HOST and settings.EMAIL_HOST_USER and settings.EMAIL_HOST_PASSWORD))
    response = Response({
        "exchange_rates": {
            "healthy": healthy,
            "last_sync_at": latest_run.finished_at if latest_run else None,
            "last_sync_status": latest_run.status if latest_run else None,
            "latest_complete_date": complete_date,
            "paid_records_without_rate": missing_paid,
        },
        "backup": {"last_restore_verified_at": backup.verified_at if backup else None,
                   "last_stored_archive_at": latest_stored_archive()},
        "email": {"smtp_configured": smtp, "failure_alert_configured": smtp and bool(settings.FX_ALERT_EMAIL)},
    })
    response["Cache-Control"] = "no-store"
    return response
