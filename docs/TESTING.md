# Verification scope

Run with Node 22.23.4 or a newer supported 22.x security patch. Run `npm ci` first. The tools create isolated databases; do not replace their MongoMemoryServer URIs with real database credentials.

| Command | Actual scope |
| --- | --- |
| `npm test` | HTTP/database workflows plus security and infrastructure regressions in tests/workflows.test.js, tests/production.test.js and tests/infrastructure.test.js. |
| `npm run lint` | ESLint checks source, routes, helpers, models, scripts, browser JavaScript and tests. |
| `npm run build` | Syntax checks and compiles every EJS template; confirms required assets. There is no browser framework bundle. |
| `npm run test:load` | 40 authenticated disposable students, Mongo-backed sessions, 30 fixture PGs, 800 timed requests including searches, thumbnails, full photos and 120 saved inquiries. Real bcrypt sign-ins occur before timing. Writes work/load-test-results.json. |
| `npm run test:restore` | Requires mongodump/mongorestore/tar. Dumps an isolated database, verifies archive hashes, restores to a fresh *_restore_test database and new disk roots, compares records/files, checks restored login/public images/private documents and refuses repeat overwrite. Writes work/restore-test-results.json. |

The scanner integration suite runs a local protocol stub with clean, detected-threat and stale-definition responses. It does not run the actual ClamAV engine. Email tests use an injected transport and signed synthetic webhooks, never an actual provider recipient. MFA tests use OTPAuth and real hashing/encryption/atomic replay checks. Production gate tests use HTTPS-forwarding headers and secure cookies with isolated database fixtures.

Browser QA uses a separate disposable localhost origin, with 320px/390px mobile and 1280px desktop viewports. Checks include no page overflow, labels, loaded images, mobile navigation, sticky contact and gallery arrow/Escape keyboard behavior. This is essential accessibility coverage, not a complete WCAG certification, screen-reader study or real-device matrix.

The local load test is a workstation result, not proof of hosted capacity. It excludes WAN/TLS latency, actual Atlas, scanner workload and real email. Memory includes the app and load generator, but excludes the MongoDB child process. Re-run on the selected isolated staging host and include scanner signature reload/upload load before public launch. It is a short three-round scenario, not a soak test.

Docker build/Compose startup, GitHub Actions execution, real Atlas connectivity, provider delivery, DNS/HTTPS, real-document authenticity and encrypted off-site restic transport need separate host/provider acceptance checks. See PRODUCTION.md. Earlier test summaries in historical implementation notes describe earlier revisions and are superseded by the current release report.
