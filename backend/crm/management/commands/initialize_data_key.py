import os
from pathlib import Path

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from dotenv import dotenv_values


class Command(BaseCommand):
    help = "Create an independent local encryption key and a separate recovery copy without displaying it."

    def add_arguments(self, parser):
        parser.add_argument("--recovery-file", required=True, help="New absolute file path outside the repository, in a protected recovery location.")

    def handle(self, *args, **options):
        project = settings.BASE_DIR.parent.resolve()
        env_path = project / ".env"
        recovery = Path(options["recovery_file"]).resolve()
        if not Path(options["recovery_file"]).is_absolute() or recovery.is_relative_to(project):
            raise CommandError("Choose an absolute recovery file path outside the repository.")
        if not recovery.parent.is_dir() or recovery.exists():
            raise CommandError("Choose a new filename in an existing protected directory.")
        if settings.DATA_ENCRYPTION_KEYS or dotenv_values(env_path).get("DATA_ENCRYPTION_KEYS"):
            raise CommandError("An encryption key is already configured; it has not been replaced.")
        original = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
        key = Fernet.generate_key().decode("ascii")
        descriptor = os.open(recovery, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="ascii") as output:
            output.write(key + "\n")
        if recovery.read_text(encoding="ascii").strip() != key:
            raise CommandError("Recovery copy verification failed. The environment file has not changed.")
        lines = [line for line in original.splitlines() if not line.startswith("DATA_ENCRYPTION_KEYS=")]
        env_path.write_text("\n".join(lines).rstrip() + "\nDATA_ENCRYPTION_KEYS=" + key + "\n", encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(
            "Encryption key configured and recovery copy verified. Protect the recovery file with OS access controls, "
            "store it separately from database backups, and verify a backup before migrating. No database data was changed."
        ))
