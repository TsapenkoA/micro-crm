import os

os.environ.setdefault("DJANGO_SECRET_KEY", "test-only-secret-key")

from .base import *

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
