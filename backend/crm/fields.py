import json

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import models


def encryption():
    try:
        keys = [Fernet(key.encode("ascii")) for key in settings.DATA_ENCRYPTION_KEYS]
        if not keys:
            raise ValueError()
        return MultiFernet(keys)
    except (ValueError, TypeError, UnicodeError) as exc:
        raise ImproperlyConfigured("Configure DATA_ENCRYPTION_KEYS with independent Fernet keys.") from exc


def decrypt(value):
    try:
        return encryption().decrypt(value)
    except InvalidToken as exc:
        raise ImproperlyConfigured("Stored private data cannot be decrypted with the configured keys.") from exc


class EncryptedJSONField(models.JSONField):
    def from_db_value(self, value, expression, connection):
        decoded = super().from_db_value(value, expression, connection)
        if isinstance(decoded, dict) and set(decoded) == {"_encrypted_v1"}:
            return json.loads(decrypt(decoded["_encrypted_v1"].encode("ascii")))
        return decoded

    def get_prep_value(self, value):
        if value is None:
            return None
        payload = json.dumps(value, cls=self.encoder, ensure_ascii=False).encode("utf-8")
        return {"_encrypted_v1": encryption().encrypt(payload).decode("ascii")}


class EncryptedBinaryField(models.BinaryField):
    prefix = b"MFENC1:"

    def from_db_value(self, value, expression, connection):
        if value is None:
            return None
        value = bytes(value)
        return decrypt(value[len(self.prefix):]) if value.startswith(self.prefix) else value

    def get_prep_value(self, value):
        if value is None:
            return None
        return self.prefix + encryption().encrypt(bytes(value))
