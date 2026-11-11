from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email


class Command(BaseCommand):
    help = "Send one test email through the configured SMTP service."

    def add_arguments(self, parser):
        parser.add_argument("--to", required=True, help="Email address that will receive the test message.")

    def handle(self, *args, **options):
        recipient = options["to"]
        try:
            validate_email(recipient)
        except ValidationError as exc:
            raise CommandError("Enter a valid recipient email address.") from exc
        if (settings.EMAIL_BACKEND != "django.core.mail.backends.smtp.EmailBackend"
                or not settings.EMAIL_HOST or not settings.EMAIL_HOST_USER or not settings.EMAIL_HOST_PASSWORD):
            raise CommandError("Configure authenticated SMTP before testing email delivery.")
        try:
            sent = send_mail(
                "MicroFlow email delivery test",
                "This message confirms that MicroFlow can submit email through its configured SMTP service.",
                settings.DEFAULT_FROM_EMAIL,
                [recipient],
            )
        except Exception as exc:
            raise CommandError("The test email could not be submitted through SMTP.") from exc
        if sent != 1:
            raise CommandError("The test email was not accepted by SMTP.")
        self.stdout.write(self.style.SUCCESS("Test email submitted. Confirm arrival in the recipient inbox."))
