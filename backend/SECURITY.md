# Private data protection

## Workspace consent

An owner sends a seven-day request to an existing account. Membership does not change until that account signs in, confirms its identity and explicitly accepts in Settings > Workspace. A recipient can decline. Requests cannot be accepted by another user; ownership and an empty source workspace are checked again at acceptance. Existing company records are never moved.

## Private responses and browser policy

All API responses, including errors, use `Cache-Control: private, no-store, max-age=0` and `Vary: Cookie`. Downloaded copies remain under the recipient's control. Production HTML has a CSP that permits scripts only from the same origin. Inline styles remain necessary for charts and drag-and-drop. The Vite development server additionally permits its inline refresh bootstrap and local WebSocket connection; this policy is not the production policy. The frontend host must also send `frame-ancestors 'none'` in its HTTP CSP header: browsers ignore that directive in a meta tag.

## File scanning

Set `FILE_SCAN_HOST` and `FILE_SCAN_PORT` to a trusted ClamAV daemon with current signature databases. The connection must be private (localhost or a protected private network), never a public unauthenticated endpoint. File bytes are sent to that daemon for scanning. Configure its stream limit to at least 5 MB and its timeouts above the application scan timeout. Uploads and downloads fail closed with HTTP 503 if no scanner is configured, the verdict is incomplete, or it is unavailable. A malicious verdict returns a controlled validation error. Existing attachments are scanned before download too. File signatures and limits remain additional checks, not a substitute for antivirus scanning. A clean verdict cannot guarantee a file is harmless.

For Windows x64 development, run from the repository root:

```powershell
.\scripts\start-file-scanner.ps1 -Setup
```

The script downloads the pinned official portable ClamAV archive, checks its SHA-256, downloads official signatures, binds only to `127.0.0.1:3310` and verifies clean/EICAR detection before configuring `.env`. It keeps executable files, signatures, configuration and logs under ignored `.local/`. No Windows service, firewall change or global installation is required. Restart Django after the initial setup. On another developer's PC, repeat setup with their own `.env` and database; antivirus binaries and signatures do not belong in Git.

After restarting Windows, start the local scanner again:

```powershell
.\scripts\start-file-scanner.ps1
```

The hidden FreshClam process checks for updates four times a day while running; ClamD checks for updated files every five minutes and refuses startup when signatures are older than seven days. `-Update` runs an explicit update (stop the background updater first if it holds the update log lock). Update the pinned portable release intentionally when security fixes are published; automatic signature updates do not update the engine binary. Official references: [Windows portable packages](https://docs.clamav.net/faq/faq-win32.html) and [signature updates](https://docs.clamav.net/manual/Usage/SignatureManagement.html).

Run `python manage.py check_file_scanner` from `backend` to test the real configured service. It sends clean bytes and the harmless standard EICAR test string in memory; it does not write an antivirus test file to disk. API tests with real ClamAV should verify a clean PDF upload and download with matching hashes and roll back the test record. Mocked scanner unit tests alone are not an integration result.

## Encryption rollout and recovery

Encrypted JSON fields retain their PostgreSQL JSON type and application/API dictionary shape. Invoice seller/buyer snapshots, workspace seller/bank details, client payer details and the preview payload use authenticated Fernet encryption. Attachment and avatar bytes use authenticated encryption too. Searchable contact names, email, phone, task text, notes and activity metadata are not covered by this field-level mechanism: restrict database access and enable storage encryption for the complete database, replicas, temporary storage and backups.

Before applying encryption migrations:

1. Stop application writes and create a database backup. Verify restoration to an isolated database using `backup_database --verify-restore` before changing stored data.
2. Use `python manage.py initialize_data_key --recovery-file <absolute-protected-path-outside-repository>` to generate an independent Fernet key and verify its recovery copy. The parent directory must already exist and have restricted access (especially on Windows, where file mode 0600 does not configure ACLs). The command refuses to overwrite an existing key. Store it as `DATA_ENCRYPTION_KEYS` in the local ignored `.env` or hosting secret store. Never derive it from a password or `DJANGO_SECRET_KEY`.
3. Keep a separate recoverable copy in an access-controlled secret manager or offline encrypted storage. A database archive alone cannot recover encrypted values. Do not store a plaintext key next to database backups. Confirm that the recovery copy is accessible before running migrations.

   A second file on the same PC protects against accidental `.env` loss but not loss of that PC. An off-device copy must be made only to an explicitly chosen trusted destination; never put it in Git. Each reviewer uses a newly generated local key and test database rather than receiving another developer's key or personal data.
4. Run encryption tests and rehearse migration/rollback on a restored database. Run `migrate` only after that rehearsal succeeds. Migrations re-read and compare values; errors roll back their transaction. They do not delete records or reset migration history.
5. Verify existing invoice PDFs, saved profiles and attachment downloads. Restore service only after verification. Retain the pre-migration backup until acceptance. Existing unencrypted archives still contain plaintext and need restricted access and encrypted storage.

`DATA_ENCRYPTION_KEYS` is a comma-separated key ring: the first key encrypts new writes, all configured keys can decrypt reads. For rotation, add a new key first, keep the old keys, re-encrypt every protected field and verify restoration before removing an old key. Losing all valid keys makes encrypted records unrecoverable. A key held by the same application cannot protect against compromise of that application or its administrator. This mechanism complements workspace permissions and storage encryption; it does not replace them.

Reversing the encryption data migrations decrypts the protected columns while keys remain available, before reversing the field definitions. Perform reversal offline and protect the resulting plaintext backup/database. Do not migrate forward with a key that has not been backed up separately.

## Verification

Run `uv run pytest` in `backend` and `npm.cmd test -- --maxWorkers=2` plus `npm.cmd run build` in `frontend`. Backend tests use an isolated PostgreSQL database and a test-only encryption key. Coverage includes recipient-only consent, expired and declined requests, CSRF, data added after a request, raw PostgreSQL ciphertext, key rotation, tampering, missing keys, encryption/decryption migrations, missing scanner and malicious/error scan verdicts. Scanner stubs in legacy file tests do not establish that a real daemon is available; verify that integration with a clean file and the standard EICAR test file in an isolated environment before enabling file transfers for customers.
