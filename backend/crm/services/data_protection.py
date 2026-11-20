import json

from crm.fields import EncryptedBinaryField, encryption


def rewrite(apps, schema_editor, specs, decrypt_only=False):
    encryption()
    connection = schema_editor.connection
    database = connection.alias
    quote = connection.ops.quote_name
    for label, name, fields in specs:
        model = apps.get_model(label, name)
        for record in model.objects.using(database).only("pk", *fields).iterator(chunk_size=50):
            values = {field: getattr(record, field) for field in fields}
            if decrypt_only:
                assignments, params = [], []
                for name, value in values.items():
                    field = model._meta.get_field(name)
                    if isinstance(field, EncryptedBinaryField):
                        params.append(bytes(value) if value is not None else None)
                        assignments.append(f"{quote(field.column)} = %s")
                    else:
                        params.append(json.dumps(value, cls=field.encoder))
                        assignments.append(f"{quote(field.column)} = %s::jsonb")
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"UPDATE {quote(model._meta.db_table)} SET {', '.join(assignments)} WHERE {quote(model._meta.pk.column)} = %s",
                        [*params, record.pk],
                    )
            else:
                model.objects.using(database).filter(pk=record.pk).update(**values)
                saved = model.objects.using(database).values(*fields).get(pk=record.pk)
                if saved != values:
                    raise RuntimeError("Private data migration verification failed; no changes were committed.")


def accounts_forward(apps, schema_editor):
    rewrite(apps, schema_editor, ACCOUNTS)


def accounts_reverse(apps, schema_editor):
    rewrite(apps, schema_editor, ACCOUNTS, decrypt_only=True)


def clients_forward(apps, schema_editor):
    rewrite(apps, schema_editor, CLIENTS)


def clients_reverse(apps, schema_editor):
    rewrite(apps, schema_editor, CLIENTS, decrypt_only=True)


def invoices_forward(apps, schema_editor):
    rewrite(apps, schema_editor, INVOICES)


def invoices_reverse(apps, schema_editor):
    rewrite(apps, schema_editor, INVOICES, decrypt_only=True)


ACCOUNTS = [("accounts", "Workspace", ("bank_details", "seller_details")),
            ("accounts", "UserAvatar", ("image",)), ("accounts", "PreviewDataset", ("payload",))]
CLIENTS = [("clients", "Client", ("bank_details",)), ("clients", "ClientAttachment", ("content",))]
INVOICES = [("invoices", "Invoice", ("seller_snapshot", "buyer_snapshot"))]
