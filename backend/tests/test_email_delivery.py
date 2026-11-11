from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError


def test_email_delivery_check_requires_smtp(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
    with pytest.raises(CommandError, match="Configure authenticated SMTP"):
        call_command("check_email_delivery", to="operator@example.com")


def test_email_delivery_check_submits_one_message(settings, monkeypatch):
    settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    settings.EMAIL_HOST = "smtp.example.com"
    settings.EMAIL_HOST_USER = "operator@example.com"
    settings.EMAIL_HOST_PASSWORD = "configured-in-environment"
    sent = []
    monkeypatch.setattr("crm.management.commands.check_email_delivery.send_mail", lambda *args: sent.append(args) or 1)
    output = StringIO()
    call_command("check_email_delivery", to="operator@example.com", stdout=output)
    assert sent[0][3] == ["operator@example.com"]
    assert "Confirm arrival" in output.getvalue()
