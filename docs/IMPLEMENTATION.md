# PG Dekho implementation plan and audit

Baseline: Node runtime checked locally; Express ^4.18.2, EJS ^3.1.9, Mongoose ^7.5.2. Four unstyled listing templates, one listing schema and inline CRUD routes. No authentication, sessions, validation middleware, upload service, review model, static assets, or deployment configuration. The original initializer deletes all listings before inserting holiday sample data.

1. Extend models/listing.js without deleting legacy fields or records. Add models/user.js and models/inquiry.js. Explicit publication status excludes legacy sample records.
2. Replace unsafe inline CRUD in app.js with validated PG routes and authentication/authorization; use lib/ for filtering, security and input parsing.
3. Add shared EJS partials, home/search/detail pages, account forms, owner/admin dashboards, inquiry pages and public CSS/JS.
4. Add moderated local image storage with production persistent-volume configuration, limits and image re-encoding. No external sample photographs.
5. Replace destructive initialization with refusal; supply blank onboarding template and explicit admin bootstrap script.
6. Add meaningful automated workflow tests, environment example, startup scripts and deployment guidance.

Risks: no existing auth to preserve; legacy listings lack provenance and cannot be published automatically. MongoDB and persistent image storage are required. No verified property data supplied: approved inventory starts empty. Production HTTPS and environment secrets must be configured by operator. No commits, push or deployment authorized by latest instructions.
