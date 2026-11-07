# Nestly

**Find your PG. Feel at home.** Express, EJS and MongoDB PG discovery and owner management, initially for Yelahanka and Rajajinagar, Bengaluru.

## Run locally

Use Node 22.23.4 or a newer supported 22.x security patch, plus a local development MongoDB database. Never point test tooling at real data.

```sh
npm ci
cp .env.example .env
npm start
```

On PowerShell, use `Copy-Item .env.example .env`. The default address is http://127.0.0.1:8080. Production requires additional configuration and HTTPS; see [the production runbook](docs/PRODUCTION.md).

## Architecture

- `app.js`: Express application factory, session/CSRF/role middleware, primary property/inquiry routes and startup.
- `routes/portals.js`: favorites, comparisons, contact handoffs, owner photo management and admin moderation.
- `routes/operations.js`: consent revocation, withdrawal, availability-only updates, report tracking, scans and audit UI.
- `routes/security.js`: verified email links, password recovery, signed delivery webhooks and admin MFA.
- `models/`: users, listings with approved snapshots, inquiries, audit events, persistent rate buckets, account tokens and delivery states.
- `lib/`: publication rules, validation, storage, uploads, scanner/PDF safety, email, MFA, configuration and health checks.
- `views/` and `public/`: existing EJS UI, palette, branding, mobile navigation and gallery; new controls reuse existing panels/buttons.
- `scripts/`: builds, explicit operator index/admin/review commands and isolated load/restore tooling.

## Accounts and publication

Signup explicitly chooses student or owner. Student accounts do not automatically become owners, and no public endpoint grants admin access. Owners manage only their own listings. Admin promotion is an explicit operator command documented in the runbook.

New listings require complete details, sharing-wise rent, authorized exterior photos, supporting documents, a clean security scan and human admin approval. Significant edits stay private while the approved snapshot remains visible. Consent withdrawal immediately restricts approved contact/WhatsApp/location publication, and owner withdrawal hides the listing and creates a review request. Availability-only changes cannot publish pending prices, photos or descriptions.

Unversioned legacy listings require fresh review before public reads. Stored data is retained; no silent approval or destructive migration runs at startup. Use `npm run listings:audit` only against an explicitly authorized database. Read the migration section before switching a real site to this release.

Photos are decoded with pixel limits, re-encoded as WebP and given thumbnails. Limit: 4 MiB/file, 24 MiB/request, 12 photos and 3 documents/property, per-account/day/action quotas and upload concurrency guards. Separate persistent volumes hold photos and private authorization documents. Quarantined documents cannot be opened or approved. Parsing/scanning never proves government authorization or document authenticity.

## Security and external services

Sessions are HttpOnly/SameSite with Secure cookies in production and a bounded MongoDB session store. Private/session HTML uses no-store. Mutation routes require CSRF and ownership/role checks. Production owners need verified email and production admins need verified email plus TOTP MFA. Recovery tokens are hashed, expire and are one-use; resets invalidate sessions. MFA secrets are encrypted and recovery codes are hashed and single-use.

Resend must be configured before verification/recovery emails can be sent. The app distinguishes provider acceptance, delivery state and link-confirmed address ownership. With no provider it reports the feature unavailable. Phone numbers are plausibility-checked, not ownership-verified. WhatsApp and Google Maps use ordinary external links. Free OpenStreetMap embeds show Rajanukunte or reviewed, consented property coordinates. No SMS provider or booking/payment processing is configured.

The chosen deployment is Linux Docker with Caddy, ClamAV, durable volumes and MongoDB Atlas. Vercel Functions are rejected for this filesystem deployment; no serverless/local-disk durability claim is made. Hosting/email/DNS/backup accounts, real scanner engine checks, Atlas staging and production cutover require operator setup. [Deployment, backup and recovery instructions](docs/PRODUCTION.md) contain all environment variable names and exact commands.

## Verify safely

```sh
npm run lint
npm test
npm run build
npm run test:load
# Requires MongoDB Database Tools and tar on PATH, plus dev dependencies:
npm run test:restore
```

Tests and load/restore drills create their own disposable MongoDB processes and explicitly marked fictional fixtures. They do not use `MONGO_URL` to select a real test target. The initializer remains disabled; never import `init/data.js` into real inventory. Build checks JavaScript syntax, EJS compilation and required assets; this server-rendered project has no React/Vite bundle. See [test scope and limitations](docs/TESTING.md).

GitHub CI is configured for lint, tests, build, dependency audit, Docker build and the isolated load scenario. A local passing test is not evidence that GitHub Actions, Docker on the selected host, Atlas, DNS, live email or off-site backup transport have succeeded.

## Rajanukunte public directory

Nine sourced PG entries are available separately from owner-approved listings, with clear unverified labels, source dates, category filters, free maps and admin hide/restore controls. Import is explicit and idempotent; existing user accounts and owner records are untouched. See [directory import, sources and verification](docs/RAJANUKUNTE-DIRECTORY.md). This is not a complete neighborhood census or a live vacancy feed.
