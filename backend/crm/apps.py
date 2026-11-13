from django.apps import AppConfig


class CRMConfig(AppConfig):
    name = "crm"

    def ready(self):
        from .auth import signals


class MigrationConfig(AppConfig):
    def import_models(self):
        from . import models

        self.models_module = models
        self.models = self.apps.all_models[self.label]


class AccountsConfig(MigrationConfig):
    name = "crm.migrations.accounts"
    label = "accounts"


class ClientsConfig(MigrationConfig):
    name = "crm.migrations.clients"
    label = "clients"


class DealsConfig(MigrationConfig):
    name = "crm.migrations.deals"
    label = "deals"


class InvoicesConfig(MigrationConfig):
    name = "crm.migrations.invoices"
    label = "invoices"


class TasksConfig(MigrationConfig):
    name = "crm.migrations.tasks"
    label = "tasks"


class ActivityConfig(MigrationConfig):
    name = "crm.migrations.activity"
    label = "activity"
