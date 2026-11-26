import os

os.environ.setdefault("DJANGO_SECRET_KEY", "test-only-secret-key")

from .base import *

DATA_ENCRYPTION_KEYS = ["MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA="]

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
