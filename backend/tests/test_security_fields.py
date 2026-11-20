import json

import pytest
from cryptography.fernet import Fernet
from django.core.exceptions import ImproperlyConfigured
from django.db import connection

from crm.fields import EncryptedBinaryField, EncryptedJSONField


def test_json_encryption_roundtrip_tampering_and_key_rotation(settings):
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    settings.DATA_ENCRYPTION_KEYS = [old]
    field = EncryptedJSONField()
    original = {"iban": "DEMO-PRIVATE", "address": "Private address", "nested": [1, None]}
    stored = field.get_prep_value(original)
    assert "DEMO-PRIVATE" not in json.dumps(stored)
    assert field.from_db_value(json.dumps(stored), None, connection) == original
    settings.DATA_ENCRYPTION_KEYS = [new, old]
    assert field.from_db_value(json.dumps(stored), None, connection) == original
    rotated = field.get_prep_value(original)
    settings.DATA_ENCRYPTION_KEYS = [new]
    assert field.from_db_value(json.dumps(rotated), None, connection) == original
    with pytest.raises(ImproperlyConfigured):
        field.from_db_value(json.dumps(stored), None, connection)
    assert field.from_db_value(json.dumps(original), None, connection) == original


def test_binary_encryption_preserves_bytes_and_rejects_tampering(settings):
    settings.DATA_ENCRYPTION_KEYS = [Fernet.generate_key().decode()]
    field = EncryptedBinaryField()
    original = b"%PDF-1.4 private file contents"
    stored = field.get_prep_value(original)
    assert original not in stored
    assert field.from_db_value(memoryview(stored), None, connection) == original
    assert field.from_db_value(original, None, connection) == original
    with pytest.raises(ImproperlyConfigured):
        field.from_db_value(stored[:-5] + b"wrong", None, connection)


def test_missing_encryption_key_fails_closed(settings):
    settings.DATA_ENCRYPTION_KEYS = []
    with pytest.raises(ImproperlyConfigured):
        EncryptedJSONField().get_prep_value({"bank": "private"})


def test_key_setup_requires_an_external_recovery_copy(settings, tmp_path):
    from django.core.management import call_command
    from django.core.management.base import CommandError
    project = tmp_path / 'project'
    (project / 'backend').mkdir(parents=True)
    settings.BASE_DIR = project / 'backend'
    settings.DATA_ENCRYPTION_KEYS = []
    (project / '.env').write_text('PGDATABASE=example\n', encoding='utf-8')
    with pytest.raises(CommandError):
        call_command('initialize_data_key', recovery_file=str(project / 'unsafe.key'))
    recovery = tmp_path / 'recovery.key'
    call_command('initialize_data_key', recovery_file=str(recovery))
    from dotenv import dotenv_values
    assert dotenv_values(project / '.env')['DATA_ENCRYPTION_KEYS'] == recovery.read_text().strip()
    assert dotenv_values(project / '.env')['PGDATABASE'] == 'example'
    with pytest.raises(CommandError):
        call_command('initialize_data_key', recovery_file=str(tmp_path / 'other.key'))
