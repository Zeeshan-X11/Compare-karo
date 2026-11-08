# PG Dekho production deployment and operations

This release keeps Express, EJS and MongoDB. It targets one Linux Docker host with durable filesystem volumes, MongoDB Atlas, Resend email, and Caddy HTTPS. It has not been deployed to a paid host from this workspace. Provider accounts, DNS, credentials and real-data migration require the operator's setup and approval.

## Architecture and limits

- Caddy exposes ports 80/443 and forwards to the app on the private Docker network. Do not expose app port 8080 to the Internet.
- The app uses one Mongoose pool capped at 20 connections and a Mongo-backed session pool capped at 10. Browser requests reuse these pools.
- `nestly_photos` contains re-encoded WebP photos and thumbnails. `/media` checks publication/owner permissions; it is not an unrestricted static directory.
- `nestly_documents` contains private authorization documents. They require an authorized owner/admin session, no-store delivery, sandbox headers and attachment delivery for PDFs.
- Uploads: 4 MiB/file, 24 MiB/request, frontend batch target below 23 MiB, 12 photos and 3 documents/property, 2 simultaneous multipart requests globally and 1/account, 100 MiB of attempted request bytes/account/day, 30 upload actions/account/hour, 20 properties/account. Quotas include failed attempts and reset on their fixed UTC window boundaries.
- Database action limits are persistent and endpoint-specific. Inquiries: 20/account/hour plus 1,200/IP/hour; reports: 10/account/hour plus 600/IP/hour; contact redirects: 120/account/hour plus 2,400/IP/hour. Shared Wi-Fi does not share one 20-action quota. Authentication also has account/email and IP limits; MFA challenges are account-limited.
- PDF validation runs in a worker with heap and time limits. File validation does not establish legal authenticity. A human must check issuer, holder, address, expiry, applicable permissions and supporting evidence.
- HTML carrying session CSRF fields and private pages use no-store. Images have short private revalidation caching. There is no shared HTML cache or Redis requirement.

## Hosting choice and external setup

1. Provision a supported Linux x64 VM with Docker Engine and Compose v2. Measure the host under expected upload and browsing load. Do not buy hosting automatically.
2. Create a MongoDB Atlas cluster and a dedicated application database named `nestly`. Use a database user scoped to this database. Restrict the Atlas network allowlist to the host's egress IP and explicitly authorized operator IPs. Use the SRV TLS connection string. Never disable certificate or hostname validation and never use `0.0.0.0/0` as a launch shortcut.
3. Configure a domain and its DNS on the chosen host. Caddy manages HTTPS certificates when the domain resolves correctly and ports 80/443 are reachable. Keep SSH restricted and protect hosting/Atlas accounts with MFA.
4. Configure Resend, a verified sending domain and the sender mailbox. Apply Resend's SPF/DKIM instructions and an appropriate DMARC policy. Configure the signed webhook at `/webhooks/email` for sent, delivered, bounced, complained and failed events. Set the webhook secret. A provider-accepted message is not guaranteed delivery; only a successful one-time confirmation link verifies account email ownership.
5. Configure an encrypted, off-host restic repository and a private password file. Keep its keys and the MFA encryption key in an operator-controlled vault. Backups on the same VM are insufficient.

Official references: [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools).

## Environment configuration

Copy `.env.example` to `.env.production` on the host and set mode 600. Do not put credentials into Git, chat, screenshots or shell command arguments. Generate secrets in a password manager or private provisioning process.

| Names | Requirement |
| --- | --- |
| `NODE_ENV`, `PORT` | Production mode and internal listening port; Compose supplies these. |
| `MONGO_URL` | Atlas SRV URI for the `nestly` database; required. |
| `SESSION_SECRET` | Required, at least 32 characters from secure randomness; preserve between restarts. |
| `APP_ORIGIN`, `APP_DOMAIN` | Public HTTPS origin and hostname, respectively; origin has no extra path/query. |
| `MFA_ENCRYPTION_KEY` | Required, 32 securely random bytes encoded as base64. Back it up separately; losing it prevents decrypting enrolled TOTP secrets. |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_WEBHOOK_SECRET` | Required for this production configuration. |
| `UPLOAD_DIR`, `AUTHORIZATION_DIR`, `STORAGE_DURABLE` | Compose supplies distinct durable mounts. Keep them outside `public/` and never mount them as unrestricted proxy/static roots. |
| `MIN_MONTHLY_RENT`, `MAX_MONTHLY_RENT` | Optional business validation bounds. Changing publication rules also requires a publication-policy version change and re-review of existing public records. |
| `NODE_OPTIONS` | Compose bounds the app's JavaScript heap. Native image memory is additionally bounded through upload concurrency, decoded pixel limits and container memory. |

There is no SMS provider. Email ownership is verified; phone numbers are plausibility-checked but phone ownership is not verified. WhatsApp and Google Maps are external handoff links, not paid messaging/maps APIs.

## Exact deployment sequence

Run these steps only after provider setup, real-data preservation review and authorization for the host deployment. Use the reviewed PG Dekho checkout; do not copy `.env`, `work/`, test outputs or development databases into an image.

```sh
cp .env.example .env.production
chmod 600 .env.production
# Fill the required configuration privately before continuing.
docker compose config --quiet
docker compose build
docker compose ps
docker compose run --rm --no-deps app npm run db:indexes
docker compose run --rm --no-deps app npm run listings:audit
docker compose up -d app proxy
docker compose ps
curl --fail https://YOUR_DOMAIN/health/live
curl --fail https://YOUR_DOMAIN/health/ready
```

`db:indexes` creates declared indexes without dropping indexes or rewriting records. Resolve duplicate legacy email addresses manually if a unique-index build fails. Back up first and run this during the approved maintenance window. Application startup disables automatic index builds in production.

`listings:audit` is read-only, uses a cursor, disables automatic index creation and prints only listing IDs, states and validation findings. It does not approve, unpublish, rewrite or delete records. Use a read-only Atlas user when producing the inventory report.

Record the deployed image ID/digests, Node version, configuration revision (without secret values), migration reconciliation and test results. Resolve and record approved Caddy image digests on the actual host before public launch and update them through reviewed maintenance.

## Existing real data and legacy review

The release deliberately does not automatically migrate real data. Before making the new deployment public:

1. Identify the actual source database and upload/document directories privately. The development/test directories are not migration sources. Quiesce writes, take a database dump and matching file archives, and verify checksums and collection counts.
2. Restore first into an isolated staging environment with separate credentials. Preserve ObjectIds, file keys, owner relationships, document hashes and existing accounts. Do not import `init/data.js`, integration fixtures, `work/` databases or QA media.
3. Reconcile source and target counts and verify sampled logins, references, image access and private-document permissions. Keep the original source and backup intact. A real-data import/cutover is a separately authorized operational step.
4. Review the read-only legacy report. Unversioned listings are excluded from new public reads without rewriting their stored data. Owners/admins see a review notice. This visibility change must be communicated before switching traffic.
5. Owners complete real missing details and submit. Admins scan/review evidence, confirm photo rights, record any location checks and approve. Only approval assigns the current publication policy and public snapshot. Never mark a legacy record current by changing the version field directly.
6. For subsequent rule changes, bump `POLICY_VERSION` in `lib/publication.js`, review existing inventory and repeat the controlled process. A version tag is an application approval boundary, not proof that a database administrator never changed data externally.

Normal significant edits retain the previously approved public version. Revocations of contact, WhatsApp and exact-location consent restrict that approved version immediately and require approval before permission is re-granted there. Owner withdrawal hides a property immediately and creates an admin review request. Availability-only updates cannot publish candidate descriptions, photos, prices, room totals or new sharing types.

## Admin bootstrap and recovery

Register the intended account, then use the trusted operator terminal:

```sh
docker compose exec app npm run admin:promote -- REGISTERED_ADMIN_EMAIL
```

Promotion revokes existing sessions and records an operator audit event. Sign in again, open `/account/security`, verify the email through the real provider, enroll a TOTP authenticator and save the one-use recovery codes. Production admin routes and private-document access require verified email, enrolled MFA and an MFA-verified session. Production owners must verify email before owner tools; students must verify email before sending inquiries.

There are no default credentials or public role-promotion/MFA-disable endpoints. If an administrator loses both authenticator and recovery codes, require a verified operator identity check and an explicit credential-reset authorization, preserve an incident record, revoke all sessions, record an operator audit event and force re-enrollment. Do not bypass MFA through a support web form or change credentials during an automated deployment.

## Backup and restoration

Install supported MongoDB Database Tools (the local isolated restore drill used 100.19.1), restic, tar and Node on the trusted operator host. Restrict any MongoDB tools YAML containing credentials to mode 600. Its URI must select only the intended `nestly` database.

Set names `BACKUP_CONFIRM`, `BACKUP_DIRECTORY`, `MONGO_BACKUP_CONFIG`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE` privately. The confirmation value is documented in `scripts/backup.sh`. Object-store credentials are provider-specific; common restic S3 configurations use `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_DEFAULT_REGION`. Never print their values.

```sh
sh scripts/backup.sh
node scripts/verify-backup.js /ABSOLUTE/PRIVATE/BACKUP_BUNDLE
```

The backup script checks tool availability and expected volume names, stops app writes, dumps the database, archives both file volumes, creates streaming SHA-256 checksums, sends the bundle to encrypted restic storage and restarts the app even after failure. The proxy may return maintenance errors during this window. Allow a short scheduled maintenance period. Retain private local staging bundles with appropriate access controls; manage retention through a separately reviewed operator policy.

For an isolated restoration drill, set `BACKUP_DIRECTORY` to a verified bundle, `RESTORE_TARGET_URI` to a new database ending `_restore_test`, and `RESTORE_ROOT` to a new absolute directory:

```sh
npm run backup:restore-test -- --confirm-isolated-restore
```

The restore refuses existing disk roots and nonempty databases, verifies checksums, remaps `nestly.*` to the new database, uses no `--drop`, and never overwrites the original target. Only restore trusted, operator-created archives. Verify counts, hashes, relationships, logins, images and document privacy before declaring a backup restorable. Checksum validity alone is insufficient. Archive credentials, `MFA_ENCRYPTION_KEY` and provider recovery access separately in a vault.

The reproducible disposable drill requires dev dependencies and tools on PATH:

```sh
npm ci
npm run test:restore
```

It creates its own MongoDB process and test-only files, performs dump/restore and HTTP permission checks, and does not connect to the real preview or production database. It does not verify Linux Docker volume operations or off-site restic transport; those remain host acceptance checks.

## Monitoring, launch acceptance and rollback

- `/health/live` is session-free liveness. `/health/ready` checks MongoDB ping, and volume access. Responses expose only status. Monitor both through an operator-configured uptime service; no monitoring subscription is configured here.
- Review structured application errors, container restarts, disk usage, backup freshness, Atlas connection/operation counts, bounced/complained email. Logs omit bodies, credentials, cookies, tokens and provider error payloads. Set disk and backup-failure alerts on the actual host.
- Test actual HTTPS cookies, email delivery and link completion, webhook signatures, MFA recovery, a genuine authorization-document review and image uploads in staging.
- Run the 40-student load scenario against an isolated database on the selected host/Atlas tier before launch. The local test excludes TLS and WAN latency. Test concurrent uploads on the host before estimating capacity.
- Confirm a tested rollback image within the corrected publication/privacy policy. Never roll back to a build that re-exposes revoked consent or legacy unreviewed inventory. No data deletion is part of code rollback. Any database restoration to a real environment needs separate authorization.

Vercel Functions are intentionally unsupported for this filesystem deployment, and production configuration rejects that environment. The chosen VM accepts bounded multipart requests without a serverless request-body limit. A future Vercel deployment requires an object-storage adapter, distinct public/private policies, secure signed direct uploads and a separately tested workflow; it is not implemented or claimed here.
