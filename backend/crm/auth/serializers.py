from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=254, required=False)
    email = serializers.EmailField(max_length=254, required=False)
    password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=4096)

    def validate(self, attrs):
        if bool(attrs.get("username")) == bool(attrs.get("email")):
            raise serializers.ValidationError("Provide an email address or username.")
        return attrs


def check_password(value, user):
    try:
        validate_password(value, user)
    except DjangoValidationError as error:
        raise serializers.ValidationError({"password": error.messages})


class NewPasswordSerializer(serializers.Serializer):
    password = serializers.CharField(trim_whitespace=False, max_length=4096)
    password_confirm = serializers.CharField(trim_whitespace=False, max_length=4096)

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({"password_confirm": ["Passwords do not match."]})
        return attrs


class UsernameSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, validators=[UnicodeUsernameValidator()])

    def validate_username(self, value):
        if "@" in value:
            raise serializers.ValidationError("Use a username without @; enter your email separately.")
        if self.context.get("check_username_unique") is False:
            return value
        users = get_user_model().objects.filter(username__iexact=value)
        if self.instance:
            users = users.exclude(pk=self.instance.pk)
        if users.exists():
            raise serializers.ValidationError("This username is already taken.")
        return value


class SignupSerializer(NewPasswordSerializer, UsernameSerializer):
    email = serializers.EmailField(max_length=254)


class EmailSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128)


class ResetSerializer(NewPasswordSerializer):
    uid = serializers.CharField(max_length=100)
    token = serializers.CharField(max_length=200)
