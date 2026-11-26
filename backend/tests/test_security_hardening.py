import time
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.http import JsonResponse
from django.test import RequestFactory
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from crm.api.middleware import PrivateResponseMiddleware
from crm.models import Client, ClientAttachment, WorkspaceJoinRequest, WorkspaceMembership
from crm.services.uploads import FileScanUnavailable, scan_upload


def test_private_api_errors_are_not_cacheable():
    response = PrivateResponseMiddleware(lambda request: JsonResponse({}, status=403))(RequestFactory().get('/api/v1/clients'))
    assert response['Cache-Control'] == 'private, no-store, max-age=0'
    assert 'Cookie' in response['Vary']
    assert "frame-ancestors 'none'" in response['Content-Security-Policy']


@pytest.mark.parametrize('verdict,exception', [(b'stream: OK\0', None), (b'stream: Eicar-Test-Signature FOUND\0', ValidationError), (b'stream: scan failed ERROR\0', FileScanUnavailable), (b'', FileScanUnavailable)])
def test_scanner_requires_a_complete_clean_verdict(settings, monkeypatch, verdict, exception):
    settings.FILE_SCAN_HOST = 'localhost'
    class Scanner:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def settimeout(self, timeout): pass
        def sendall(self, content): pass
        def recv(self, size): return verdict
    monkeypatch.setattr('crm.services.uploads.socket.create_connection', lambda *args, **kwargs: Scanner())
    if exception:
        with pytest.raises(exception):
            scan_upload(b'%PDF-1.4 test')
    else:
        scan_upload(b'%PDF-1.4 test')


def test_scanner_unavailable_is_not_a_clean_result(settings, monkeypatch):
    settings.FILE_SCAN_HOST = ''
    with pytest.raises(FileScanUnavailable):
        scan_upload(b'file')
    settings.FILE_SCAN_HOST = 'localhost'

    def unavailable(*args, **kwargs):
        raise OSError('private connection details')

    monkeypatch.setattr('crm.services.uploads.socket.create_connection', unavailable)
    with pytest.raises(FileScanUnavailable, match='File security scanning is unavailable'):
        scan_upload(b'file')


def test_scanner_check_requires_real_detection(monkeypatch):
    from io import StringIO

    from django.core.management import call_command
    from django.core.management.base import CommandError

    path = 'crm.management.commands.check_file_scanner.scan_upload'

    def scanner(content):
        if b'EICAR-STANDARD-ANTIVIRUS-TEST-FILE' in content:
            raise ValidationError({'file': 'Rejected'})

    monkeypatch.setattr(path, scanner)
    output = StringIO()
    call_command('check_file_scanner', stdout=output)
    assert 'EICAR rejected' in output.getvalue()
    monkeypatch.setattr(path, lambda content: None)
    with pytest.raises(CommandError, match='accepted EICAR'):
        call_command('check_file_scanner', stdout=StringIO())


@pytest.mark.django_db
def test_join_request_expiry_decline_and_changed_source(user, other_user):
    api = APIClient(enforce_csrf_checks=True)
    api.force_login(other_user)
    session = api.session
    session['auth_time'], session['reauth_user'] = time.time(), str(other_user.pk)
    session.save()
    token = api.get('/api/v1/auth/csrf').json()['csrfToken']
    invitation = WorkspaceJoinRequest.objects.create(workspace=user.workspace_membership.workspace, user=other_user, requested_by=user, expires_at=timezone.now() + timedelta(days=1))
    path = f'/api/v1/workspace/join-requests/{invitation.pk}'
    assert api.post(path, {'decision': 'accept'}, format='json').status_code == 403
    assert api.get('/api/v1/workspace/settings').json()['join_requests'][0]['id'] == str(invitation.pk)
    source = other_user.workspace_membership.workspace_id
    Client.objects.create(workspace_id=source, created_by=other_user, name='Private record')
    assert api.post(path, {'decision': 'accept'}, format='json', HTTP_X_CSRFTOKEN=token).status_code == 400
    assert WorkspaceMembership.objects.get(user=other_user).workspace_id == source
    assert api.post(path, {'decision': 'decline'}, format='json', HTTP_X_CSRFTOKEN=token).status_code == 204
    assert not WorkspaceJoinRequest.objects.filter(pk=invitation.pk).exists()
    invitation.pk = None
    invitation.expires_at = timezone.now() - timedelta(seconds=1)
    invitation.save()
    assert api.post(f'/api/v1/workspace/join-requests/{invitation.pk}', {'decision': 'accept'}, format='json', HTTP_X_CSRFTOKEN=token).status_code == 404


@pytest.mark.django_db
def test_bank_details_are_encrypted_in_postgresql_and_readable_by_models(user):
    workspace = user.workspace_membership.workspace
    workspace.bank_details = {'iban': 'DEMO-PRIVATE-ACCOUNT'}
    workspace.seller_details = {'name': 'Seller', 'address': 'Private street'}
    workspace.save()
    with connection.cursor() as cursor:
        cursor.execute('SELECT bank_details, seller_details FROM accounts_workspace WHERE id = %s', [workspace.pk])
        stored = str(cursor.fetchone())
    assert 'DEMO-PRIVATE-ACCOUNT' not in stored and 'Private street' not in stored
    assert '_encrypted_v1' in stored
    workspace.refresh_from_db()
    assert workspace.bank_details['iban'] == 'DEMO-PRIVATE-ACCOUNT'
    assert workspace.seller_details['address'] == 'Private street'


@pytest.mark.django_db
def test_files_are_not_saved_or_downloaded_without_scanning(settings, api, user, client_record, other_user):
    settings.FILE_SCAN_HOST = ''
    api.force_login(user)
    token = api.get('/api/v1/auth/csrf').json()['csrfToken']
    path = f'/api/v1/clients/{client_record.pk}/attachments'
    response = api.post(path, {'file': SimpleUploadedFile('brief.pdf', b'%PDF-1.4 test')}, format='multipart', HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 503
    assert not ClientAttachment.objects.exists()
    attachment = ClientAttachment.objects.create(client=client_record, uploaded_by=user, name='existing.pdf', content_type='application/pdf', size=12, content=b'%PDF-1.4 old')
    assert api.get(f'{path}/{attachment.pk}').status_code == 503
    api.force_login(other_user)
    assert api.get(f'{path}/{attachment.pk}').status_code == 404
