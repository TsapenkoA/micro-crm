import socket
import struct

from django.conf import settings
from rest_framework.exceptions import APIException, ValidationError


class FileScanUnavailable(APIException):
    status_code = 503
    default_detail = "File security scanning is unavailable. Please try again later."


def scan_upload(content):
    if not settings.FILE_SCAN_HOST:
        raise FileScanUnavailable()
    try:
        with socket.create_connection((settings.FILE_SCAN_HOST, settings.FILE_SCAN_PORT), timeout=10) as scanner:
            scanner.settimeout(20)
            scanner.sendall(b"zINSTREAM\0")
            for offset in range(0, len(content), 65536):
                chunk = content[offset:offset + 65536]
                scanner.sendall(struct.pack("!I", len(chunk)) + chunk)
            scanner.sendall(struct.pack("!I", 0))
            result = bytearray()
            while b"\0" not in result:
                chunk = scanner.recv(4096)
                if not chunk or len(result) + len(chunk) > 8192:
                    raise FileScanUnavailable()
                result.extend(chunk)
    except (OSError, TimeoutError) as exc:
        raise FileScanUnavailable() from exc
    verdict = bytes(result).split(b"\0", 1)[0]
    if verdict == b"stream: OK":
        return
    if verdict.startswith(b"stream: ") and verdict.endswith(b" FOUND"):
        raise ValidationError({"file": "This file was rejected by the security scanner."})
    raise FileScanUnavailable()
