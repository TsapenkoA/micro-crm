from django.db import migrations, models


def preserve_displayed_descriptions(apps, schema_editor):
    Deal = apps.get_model("deals", "Deal")
    Note = apps.get_model("clients", "ClientNote")
    database = schema_editor.connection.alias
    for deal in Deal.objects.using(database).only("pk").iterator():
        text = Note.objects.using(database).filter(deal_id=deal.pk).order_by("-created_at", "-id").values_list("text", flat=True).first()
        if text:
            Deal.objects.using(database).filter(pk=deal.pk).update(description=text)


class Migration(migrations.Migration):

    dependencies = [
        ('deals', '0004_deal_fx_rate_date'),
        ('clients', '0006_clientnote_deal'),
    ]

    operations = [
        migrations.AddField(
            model_name='deal',
            name='description',
            field=models.TextField(blank=True, default='', max_length=10000),
        ),
        migrations.RunPython(preserve_displayed_descriptions, migrations.RunPython.noop),
    ]
