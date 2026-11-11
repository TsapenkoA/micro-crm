from io import BytesIO

from django.http import HttpResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from crm.auth.security import AuthThrottle
from crm.auth.views import user_data
from crm.models import UserAvatar


class AvatarView(APIView):
    throttle_classes = [AuthThrottle]
    rate_scope = "security"

    def get(self, request):
        avatar = UserAvatar.objects.filter(user=request.user).first()
        if avatar is None:
            raise NotFound("No avatar is saved for this account.")
        response = HttpResponse(bytes(avatar.image), content_type="image/jpeg")
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    def post(self, request):
        if set(request.data) != {"avatar"} or "avatar" not in request.FILES:
            raise ValidationError({"avatar": ["Choose an image file."]})
        upload = request.FILES["avatar"]
        if upload.size > 2 * 1024 * 1024 or upload.content_type not in ("image/jpeg", "image/png", "image/webp"):
            raise ValidationError({"avatar": ["Choose a JPEG, PNG or WebP image under 2 MB."]})
        try:
            with Image.open(upload) as image:
                if image.width > 4096 or image.height > 4096:
                    raise ValueError("Image dimensions are too large.")
                image.verify()
            upload.seek(0)
            with Image.open(upload) as image:
                result = ImageOps.exif_transpose(image)
                result.thumbnail((256, 256))
                output = BytesIO()
                result.convert("RGB").save(output, format="JPEG", quality=85, optimize=True)
        except (OSError, ValueError, Image.DecompressionBombError, UnidentifiedImageError):
            raise ValidationError({"avatar": ["Choose a valid image under 4096 × 4096 pixels."]})
        UserAvatar.objects.update_or_create(user=request.user, defaults={"image": output.getvalue()})
        return Response({"user": user_data(request.user)})

    def delete(self, request):
        UserAvatar.objects.filter(user=request.user).delete()
        return Response({"user": user_data(request.user)})
