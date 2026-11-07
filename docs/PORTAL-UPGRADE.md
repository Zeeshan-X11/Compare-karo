# Portal upgrade audit and implementation plan

Inspected the Express/EJS/Mongoose application, schemas, validation/filter/photo/authorization helpers, all portal and shared templates, CSS/JS, tests, initializer, scripts, Docker/environment configuration, and README. Existing stack: Express 4, Mongoose 7, EJS, Mongo-backed sessions, CSRF, bcrypt, role/ownership controls, multipart image and private PDF/scan validation. Existing public pagination is 12 records. Current dashboards cap records without pagination; public queries fetch private fields unnecessarily. No npm build exists.

Reuse: current views/partials, styling classes and branding, existing listing form, public detail/card templates, inquiry routes, moderation and document routes. No framework replacement and no new public inventory.

1. models/listing.js + lib/publication.js: atomic approved public snapshot; owner edits remain pending while approved content/media stay visible. Legacy published records continue to work without destructive migration. Admin approval atomically replaces the snapshot. Unpublishing/suspension takes precedence.
2. lib/input.js + owner form: per-sharing rent/room counts, fee breakdown, authorized WhatsApp, suggested coordinates; stricter publish-time checks; publication-safe photo editing. Existing data is retained, not silently certified.
3. Student routes + existing templates: persistent favorites, session comparison (max 3), authorized contact/WhatsApp, Google Maps link/fallback, sharing-specific move-in totals and mobile sticky contact, existing inquiry history extended with replies/scheduling.
4. Admin routes + templates: evidence-based verification, corrections/rejection reasons, owner suspension/restoration, reports disposition and basic counts. Owner analytics use actual recorded views/contact requests/inquiries.
5. Query projections, indexes, pagination, connection pooling and bounded concurrent uploads. Private docs always require ownership/admin access, even while a public revision is visible.
6. Existing regression suite plus snapshot/privacy/portal tests; production validation build for server-rendered source and EJS; isolated 40-user concurrency exercise with measured results and explicit limits.

No commits, push or public deployment. Tests use isolated fixtures only; no fake functionality, inventory, phone ownership claims or verification claims. Phone format/plausibility checks cannot prove control of a number without OTP. Map coordinates require explicit admin review before exact publication. Human legal/document review remains operational.

## Completed verification

Implemented all portal routes and persisted data described above, reusing the existing Express/EJS forms, cards, inbox and moderation screens. The final regression suite passes 40 tests; production validation compiles 23 templates and checks 15 JS files; production dependency audit reports zero vulnerabilities. The 40-user final load run completed 600 HTML requests with zero failures and p95 1063 ms. See TESTING.md for scope and limitations. Browser checks verified owner revision submission, student favorites/comparison/cost/inquiry history, admin corrections/evidence/owner controls and a mobile sticky contact bar. Existing preview users and property were preserved during restart.
