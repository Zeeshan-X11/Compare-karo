# Correction-pass file map

This describes the production-readiness correction pass, not every difference from the original tutorial repository. The working tree already contained the Nestly portals and other pending changes. Existing work and legacy view deletions were preserved; this pass did not delete real accounts, listings, photos or documents.

| Files | Change and reason |
| --- | --- |
| `app.js` | Integrate runtime/configuration checks, private caching policy, sessions, role/MFA gates, persistent endpoint limits, guarded edit uploads, document delivery, publication/inquiry corrections, audit calls, safe errors, health and graceful shutdown. |
| `lib/publication.js` | Current-policy approval boundary, approved snapshots, immediate privacy restrictions, active-owner checks and publication validation. |
| `lib/input.js`, `lib/marketplace.js`, `lib/filters.js` | Explicit safe validation errors, complete publication checks, deduplicated sharing options and strict calendar/scheduled-visit handling. |
| `lib/photos.js`, `lib/authorization.js` | Reduced upload caps, content checks, thumbnail preparation, durable storage writes, quarantine/scan metadata and bounded PDF validation. |
| `lib/limits.js`, `models/rate-bucket.js` | Persistent atomic endpoint/account/IP limits, attempted-byte quota, multipart concurrency and early body-size guards. |
| `lib/storage.js` | Separate photo/private-document filesystem roots, validated keys, restrictive creation modes and storage readiness. |
| `lib/scanner.js`, `lib/pdf-validation.js` | Private ClamAV INSTREAM integration, definition freshness, safe failure states and isolated PDF worker validation. |
| `lib/errors.js`, `lib/audit.js`, `models/audit-event.js` | Structured redacted failures and application append-only event recording/querying. |
| `lib/email.js`, `lib/mfa.js`, `lib/config.js`, `lib/health.js` | Provider-aware email, encrypted TOTP secrets and one-use recovery codes, fail-closed production configuration and readiness checks. |
| `models/user.js`, `models/listing.js`, `models/inquiry.js` | Email/session/MFA states, scan/review/withdrawal fields, approved policy metadata, thumbnail references, inquiry title snapshots and supporting indexes. |
| `models/account-token.js`, `models/email-delivery.js` | Hashed expiring one-use email tokens and provider acceptance/delivery bookkeeping. |
| `routes/portals.js` | Removable hidden favorites, stale comparison cleanup, verification scope, suspension session revocation and moderation audits. |
| `routes/operations.js` | Atomic privacy withdrawal, owner unpublish requests, availability-only updates, private report tracking, explicit scans and admin audit pages. |
| `routes/security.js` | Email verification, verified-email password reset, signed/out-of-order webhooks and administrator MFA enrollment/login. |
| `views/account.ejs`, `views/auth.ejs`, `views/favorites.ejs`, `views/admin.ejs`, `views/dashboard.ejs`, `views/review.ejs` | Add access to existing-style security, unavailable-item, review and audit controls; expose real workflow states. |
| `views/listings/form.ejs`, `views/listings/show.ejs`, `views/partials/cards.ejs`, `views/partials/inbox.ejs` | Correct caps and statuses, owner controls, approved inquiry titles, retained scheduled dates and thumbnail previews. |
| `views/partials/owner-controls.ejs`, `views/security.ejs`, `views/token-form.ejs`, `views/mfa.ejs`, `views/reports.ejs`, `views/audit.ejs` | New features rendered with the existing EJS panels, forms, tables and buttons. |
| `public/app.js`, `public/styles.css` | Client batch checks, fragment-token handling and the isolated narrow-screen table-position fix; existing palette/layout retained. |
| `scripts/promote-admin.js`, `scripts/ensure-indexes.js`, `scripts/review-legacy.js` | Audited explicit operator bootstrap, non-destructive index creation and read-only legacy findings. |
| `scripts/backup.sh`, `scripts/verify-backup.js`, `scripts/restore-backup.js`, `scripts/test-restore.js` | Quiesced encrypted backup procedure, streaming checksums, guarded isolated restore and reproducible restore verification. |
| `scripts/load-test.js` | Replace HTML-only traffic with 40 authenticated student sessions, photo/search traffic and permitted persisted inquiries. |
| `tests/workflows.test.js`, `tests/production.test.js`, `tests/infrastructure.test.js` | Existing workflow coverage plus regression, production gate, scanner protocol, webhook, MFA, privacy and restore-safety tests. |
| `package.json`, `package-lock.json`, `.nvmrc`, `eslint.config.js` | Supported runtime, tested library additions, lint tooling and verification/operator commands. |
| `Dockerfile`, `compose.yaml`, `deploy/Caddyfile`, `.dockerignore`, `.gitignore`, `.env.example`, `.github/workflows/ci.yml` | Durable non-serverless deployment, separate private policies, HTTPS/scanner/container caps, excluded data/secrets and automated validation. |
| `README.md`, `docs/TESTING.md`, `docs/PRODUCTION.md`, `docs/COSTS.md` | Current setup, precise test scope, legacy/backup/deployment procedures, provider requirements and sourced costs. |

No React rewrite, fake live inventory, public document bucket or automatic real-data migration is introduced. Changes remain local and uncommitted. CI has been configured but was not executed on GitHub from this correction pass.
