import os
import shutil
import subprocess
import uuid
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.errors import InsufficientPrivilege

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from crm.models import BackupCheck, Client, ClientLink, ClientNote, Deal, FxRate, Invoice, InvoiceItem, Workspace, WorkspaceMembership


MODELS_TO_CHECK = (Workspace, WorkspaceMembership, Client, ClientNote, ClientLink, Deal, Invoice, InvoiceItem, FxRate)


def postgres_tool(name, directory):
    executable = f"{name}.exe" if os.name == "nt" else name
    path = str(Path(directory) / executable) if directory else shutil.which(executable)
    if not path or not Path(path).is_file():
        raise CommandError(f"{name} is unavailable. Set --pg-bin to the PostgreSQL bin directory.")
    return path


def database_connection(database, user=None, password=None):
    config = settings.DATABASES["default"]
    return psycopg.connect(
        dbname=database,
        user=user or config["USER"],
        password=password if password is not None else config["PASSWORD"],
        host=config["HOST"],
        port=config["PORT"],
        autocommit=True,
    )


def record_counts(database):
    with database_connection(database) as connection:
        with connection.cursor() as cursor:
            counts = {}
            for model in MODELS_TO_CHECK:
                cursor.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(model._meta.db_table)))
                counts[model._meta.label] = cursor.fetchone()[0]
            return counts


class Command(BaseCommand):
    help = "Create a PostgreSQL archive and optionally verify it in a temporary database."

    def add_arguments(self, parser):
        parser.add_argument("--output", required=True, help="Absolute path outside the project for the new backup archive.")
        parser.add_argument("--pg-bin", help="Directory containing pg_dump and pg_restore.")
        parser.add_argument("--verify-restore", action="store_true", help="Restore to a temporary database and compare business record counts.")
        parser.add_argument("--maintenance-user", help="PostgreSQL role allowed to create and drop the temporary verification database.")

    def handle(self, *args, **options):
        output = Path(options["output"]).resolve()
        project = settings.BASE_DIR.parent.resolve()
        if not Path(options["output"]).is_absolute() or output.is_relative_to(project):
            raise CommandError("Choose an absolute backup path outside the project.")
        if output.exists():
            raise CommandError("The backup destination already exists; choose a new filename.")
        if not output.parent.is_dir():
            raise CommandError("The backup directory does not exist.")

        dump_tool = postgres_tool("pg_dump", options["pg_bin"])
        restore_tool = postgres_tool("pg_restore", options["pg_bin"])
        config = settings.DATABASES["default"]
        maintenance_password = os.getenv("PGMAINTENANCEPASSWORD") if options["verify_restore"] and options["maintenance_user"] else None
        if options["verify_restore"] and options["maintenance_user"] and not maintenance_password:
            raise CommandError("Set PGMAINTENANCEPASSWORD in the process environment for --maintenance-user.")
        environment = os.environ.copy()
        environment["PGPASSWORD"] = config["PASSWORD"]
        connection_args = ["--host", config["HOST"], "--port", str(config["PORT"]), "--username", config["USER"], "--no-password"]
        before = record_counts(config["NAME"]) if options["verify_restore"] else None

        try:
            result = subprocess.run(
                [dump_tool, *connection_args, "--format=custom", "--no-owner", "--no-privileges", "--file", str(output), config["NAME"]],
                env=environment, capture_output=True, check=False,
            )
            if result.returncode:
                raise CommandError("pg_dump failed; check the database connection and backup destination.")
            result = subprocess.run([restore_tool, "--file", os.devnull, str(output)], capture_output=True, check=False)
            if result.returncode:
                raise CommandError("The PostgreSQL backup archive could not be read.")
            if options["verify_restore"]:
                self.verify_restore(restore_tool, connection_args, environment, output, config["NAME"], before, options["maintenance_user"], maintenance_password)
                BackupCheck.objects.create(archive_bytes=output.stat().st_size)
        except Exception:
            output.unlink(missing_ok=True)
            raise
        self.stdout.write(self.style.SUCCESS(
            f"Backup created: {output}." + (" Temporary-database restore and record counts verified." if options["verify_restore"] else " Archive contents read successfully.")
        ))

    def verify_restore(self, restore_tool, connection_args, environment, archive, source_database, before, maintenance_user, maintenance_password):
        temporary_database = f"microflow_restore_{uuid.uuid4().hex[:12]}"
        with database_connection("postgres", maintenance_user, maintenance_password) as connection:
            with connection.cursor() as cursor:
                try:
                    cursor.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(
                        sql.Identifier(temporary_database), sql.Identifier(settings.DATABASES["default"]["USER"])
                    ))
                except InsufficientPrivilege as exc:
                    raise CommandError("Restore verification requires a PostgreSQL role with CREATEDB permission.") from exc
                try:
                    result = subprocess.run(
                        [restore_tool, *connection_args, "--no-owner", "--no-acl", "--exit-on-error", "--dbname", temporary_database, str(archive)],
                        env=environment, capture_output=True, check=False,
                    )
                    if result.returncode:
                        raise CommandError("The backup could not be restored to a temporary database.")
                    after = record_counts(temporary_database)
                    if before != record_counts(source_database) or before != after:
                        raise CommandError("Business record counts changed or differ from the restored database.")
                finally:
                    cursor.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(temporary_database)))
