import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR.parent / ".env")
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY in the root .env file.")
DEBUG = False
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
INSTALLED_APPS = [
    "django.contrib.auth", "django.contrib.contenttypes", "django.contrib.sessions",
    "django.contrib.messages", "allauth", "allauth.account", "allauth.socialaccount",
    "allauth.socialaccount.providers.google", "allauth.socialaccount.providers.github",
    "allauth.socialaccount.providers.microsoft",
    "rest_framework", "crm.apps.CRMConfig",
    "crm.apps.AccountsConfig", "crm.apps.ClientsConfig",
    "crm.apps.DealsConfig", "crm.apps.InvoicesConfig",
]
MIGRATION_MODULES = {
    label: f"crm.migrations.{label}"
    for label in ("accounts", "clients", "deals", "invoices")
}
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"
DATABASES = {"default": {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": os.getenv("PGDATABASE", "micro_crm"),
    "USER": os.getenv("PGUSER", "micro_crm"),
    "PASSWORD": os.getenv("PGPASSWORD", ""),
    "HOST": os.getenv("PGHOST", "localhost"),
    "PORT": os.getenv("PGPORT", "5432"),
    "OPTIONS": {"connect_timeout": 3},
}}
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "EXCEPTION_HANDLER": "crm.api.errors.exception_handler",
}
CSRF_FAILURE_VIEW = "crm.api.errors.csrf_failure"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
X_FRAME_OPTIONS = "DENY"
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTHENTICATION_BACKENDS = ["django.contrib.auth.backends.ModelBackend"]
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "APP_DIRS": True,
              "OPTIONS": {"context_processors": ["django.template.context_processors.request", "django.contrib.messages.context_processors.messages"]}}]
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://127.0.0.1:5173").rstrip("/")
LOGIN_REDIRECT_URL = FRONTEND_URL + "/oauth-result?status=success"
ACCOUNT_ADAPTER = "crm.auth.adapters.AccountAdapter"
SOCIALACCOUNT_ADAPTER = "crm.auth.adapters.SocialAdapter"
ACCOUNT_EMAIL_VERIFICATION = "none"
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "password1*", "password2*"]
ACCOUNT_EMAIL_NOTIFICATIONS = False
SOCIALACCOUNT_LOGIN_ON_GET = False
SOCIALACCOUNT_EMAIL_AUTHENTICATION = False
SOCIALACCOUNT_EMAIL_AUTHENTICATION_AUTO_CONNECT = False
SOCIALACCOUNT_STORE_TOKENS = False
ACCOUNT_REAUTHENTICATION_REQUIRED = False
SOCIALACCOUNT_PROVIDERS = {
    "google": {"SCOPE": ["openid", "email", "profile"], "OAUTH_PKCE_ENABLED": True},
    "github": {"SCOPE": ["user:email"], "OAUTH_PKCE_ENABLED": True},
    "microsoft": {"SCOPE": ["User.Read"], "OAUTH_PKCE_ENABLED": True, "TENANT": os.getenv("MICROSOFT_TENANT", "common")},
}
for provider, options in SOCIALACCOUNT_PROVIDERS.items():
    client_id = os.getenv(f"{provider.upper()}_CLIENT_ID", "")
    secret = os.getenv(f"{provider.upper()}_CLIENT_SECRET", "")
    if client_id and secret:
        options["APPS"] = [{"client_id": client_id, "secret": secret, "key": ""}]

PASSWORD_RESET_TIMEOUT = 3600
AUTH_REAUTH_SECONDS = 300
AUTH_RATE_LIMITS = {"login": (10, 300), "signup": (5, 3600), "forgot": (5, 3600),
                    "reset": (10, 300), "security": (10, 300), "oauth": (20, 300)}
EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "Micro-CRM <noreply@localhost>")
EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "True").lower() == "true"
EMAIL_TIMEOUT = 10
