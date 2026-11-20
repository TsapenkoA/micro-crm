from django.core.management.base import BaseCommand, CommandError
from rest_framework.exceptions import ValidationError

from crm.services.uploads import FileScanUnavailable, scan_upload


class Command(BaseCommand):
    help = "Verify the configured scanner accepts clean bytes and rejects the harmless EICAR antivirus test string."

    def handle(self, *args, **options):
        try:
            scan_upload(b"MicroFlow clean scanner connectivity test.\n")
            self.stdout.write("Clean content accepted.")
            eicar = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
            try:
                scan_upload(eicar)
            except ValidationError:
                self.stdout.write(self.style.SUCCESS("EICAR rejected. File scanning is available and detection is working."))
                return
        except FileScanUnavailable as exc:
            raise CommandError("The file scanner is unavailable. Start ClamAV with current signatures and check FILE_SCAN_HOST/PORT.") from exc
        raise CommandError("The scanner accepted EICAR. File transfers must remain disabled until its detection is corrected.")
