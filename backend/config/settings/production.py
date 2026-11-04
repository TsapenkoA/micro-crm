from django.core.exceptions import ImproperlyConfigured

from .base import *

DEBUG = False
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_SSL_REDIRECT = True
SECURE_REFERRER_POLICY = "no-referrer"
EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend")
if EMAIL_BACKEND != "django.core.mail.backends.smtp.EmailBackend" or not EMAIL_HOST:
    raise ImproperlyConfigured("Production requires an SMTP email backend and EMAIL_HOST.")
if not FRONTEND_URL.startswith("https://"):
    raise ImproperlyConfigured("Production FRONTEND_URL must use HTTPS.")
