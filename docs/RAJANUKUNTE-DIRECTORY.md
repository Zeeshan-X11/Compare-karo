# Rajanukunte public directory and free maps

Implemented 7 November 2026. This feature preserves Express/EJS, the existing brand, role separation and owner approval workflow.

## What is public

`/directory/rajanukunte` displays nine sourced entries: six described by their sources as Rajanukunte-area PGs and three explicitly labelled nearby (Dibbur or Shanubhoganahalli). All are labelled **Public directory · Unverified** and visible without owner/admin approval, as requested. Category filtering and pagination run against MongoDB. `/listings` and Rajanukunte search show a separate directory preview; owner-listed counts remain separate.

This is **not a complete census or a real-time availability feed**. Source pages were checked on 7 November 2026, but their underlying advertisements may be older. Rent, deposits, vacancies, ratings, precise coordinates and photos were deliberately not imported without confirmation/permission. Icons represent directory entries, not property photographs. Source pages provide further details; map links search by business name and address. Nestly inquiry/favorites/compare actions remain available on approved owner listings only.

The catalog contains only factual business names, categories and broad location references. Sources:

- [Magicbricks: PGs near Presidency University](https://www.magicbricks.com/pg-near-presidency-university-in-bangalore-pppfr): Zolo Hercules, Anusha PG, Sapphire Ultra Luxury PG for Girls, Zesto Blue Pearl, Lifestyle PG for Ladies, Green View PG for Ladies and New NMR PG for Gents.
- [Paying Guest in Bengaluru: Rajankunte Cross](https://www.payingguestinbengaluru.com/Rajankunte-Cross.html): Rudra Comforts.
- [Venkateshwara PG for Girls](https://www.payingguestinbengaluru.com/Venkateshwara-PG-for-Girls-near-Presidency-University-College-Bangalore.html): Venkateshwara New Executive PG for Girls, Dibbur.

## Storage and safe import

Source catalog: `data/rajanukunte-directory.json`. Model: `models/directory-entry.js`. Separate collection: `public_directory_entries`. No startup import and no updates to `users`, `listings`, photos, authorization documents or owner publication statuses.

Use supported Node 22.23.4 or newer 22.x. From the app directory:

```sh
# Offline validation only; no database connection or writes.
npm run directory:sync

# Set MONGO_URL to an explicitly authorized database, then:
npm run directory:sync -- --apply
```

The apply command validates the entire catalog, creates declared directory indexes and upserts by unique slug. It never deletes rows. Re-running does not duplicate entries or reset admin hiding/reasons. Review updated sources before changing checkedAt; the date is a source check, not verification of the property. Take the usual backup before an import.

For the existing Docker deployment (service `app`), after rebuilding/redeploying the image with the catalog:

```sh
docker compose exec app npm run directory:sync
docker compose exec app npm run directory:sync -- --apply
```

No new environment variables, paid accounts, Google API keys or runtime packages are required. Existing database, session and production configuration requirements remain. `npm run db:indexes` includes the directory indexes.

## Moderation and privacy

Admins use `/admin/directory` to hide/restore entries with a 10–500 character reason. Authentication, admin role, production MFA and CSRF guards apply. Visibility changes append audit events. Public queries exclude hidden rows; HTML remains no-store. There is no public submission/import endpoint and no scrape-on-request behavior. Source links must be HTTPS URLs on the reviewed source host allowlist.

Owner submissions still require the existing admin review. Public directory rows do not masquerade as owned, licensed, inspected or approved properties. A future owner claim process would need explicit verification and deduplication; it is not implemented here.

## Maps

`lib/maps.js` builds an OpenStreetMap iframe and ordinary Google Maps search links. The Rajanukunte area bounds come from [OSM relation 17417762](https://www.openstreetmap.org/relation/17417762), checked 6 November 2026. The area map has **no property pins**. It does not geocode every directory address or cover every nearby locality at its initial zoom.

Approved owner property maps show a pin only for finite, in-range coordinates with both review and publication consent. Otherwise Rajanukunte uses the general area map; other localities retain their existing external locality links. Existing public snapshot/consent filtering remains in effect. CSP allows frames only from `https://www.openstreetmap.org`. Embeds are lazy-loaded, have descriptive titles, attribution and an external map fallback. The privacy page explains third-party requests.

The [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) governs usage: visible attribution, ordinary browser caching, no bulk prefetching and best-effort availability. No SLA is implied. Google links are ordinary searches, not paid API calls or verified map pins. An experimental Overpass lookup timed out; no results or complete/live coverage are claimed from it.

## Verification

- `npm test`: **77 passed, 0 failed** (7 November 2026); disposable MongoDB only. Includes seven new directory/map tests plus existing publication, consent, private documents and role tests.
- `npm run lint`: passed.
- `npm run build`: passed; 43 JavaScript files and 35 EJS templates validated.
- Real preview: nine directory rows imported after a SHA-256-verified cold database backup. Before/after hashes of existing users and listings matched. No test records inserted into this database.
- Browser: OSM tiles visibly render, category Women returns four real sourced entries, directory appears in Rajanukunte search, and 390px layout fits without horizontal overflow. No external owner has been contacted and no current vacancy or operator authenticity has been independently verified.
- Browser moderation in a disposable database: admin hide changed the public count from nine to eight and removed the selected entry; restore returned it to Visible. No live directory row was hidden for testing. The final seven-test directory regression rerun also passed after the template refinements.
- Production deployment, live provider availability, complete neighborhood coverage and map-provider load capacity are not established by these checks. See the existing production runbook for outstanding launch requirements.

## Implementation files

| Files | Purpose |
| --- | --- |
| `lib/localities.js`, `models/listing.js`, `lib/input.js`, `lib/filters.js` | Shared Rajanukunte locality in schemas, owner validation and search. |
| `data/rajanukunte-directory.json`, `models/directory-entry.js`, `lib/directory.js` | Sourced catalog, distinct MongoDB collection, indexed queries and idempotent import. |
| `scripts/sync-directory.js`, `scripts/ensure-indexes.js`, `package.json` | Explicit operator import and index commands. |
| `routes/directory.js`, `app.js` | Public directory, admin moderation, role/CSRF guards, audit events, listings integration and OSM-only frame policy. |
| `lib/maps.js`, `lib/marketplace.js` | Free embeds, map search links and reviewed/consented coordinate checks. |
| `views/directory.ejs`, `views/admin-directory.ejs`, `views/partials/directory-cards.ejs`, `views/partials/map.ejs` | Directory, admin controls, source-labelled cards and accessible lazy map embeds. |
| `views/listings/index.ejs`, `views/listings/show.ejs`, `views/listings/form.ejs`, `views/home.ejs`, `views/info.ejs` | Search/discovery, detail map, locality selection, home link and privacy/about disclosures. |
| `views/partials/header.ejs`, `views/partials/footer.ejs`, `views/partials/search.ejs`, `views/admin.ejs`, `public/inner.css` | Navigation, role-appropriate access, responsive cards and existing visual style. |
| `tests/directory.test.js`, `tests/workflows.test.js` | Directory/map regression coverage and Rajanukunte submission/filter coverage. |
| `README.md`, `docs/RAJANUKUNTE-DIRECTORY.md` | Operator instructions, sources, limitations and test evidence. |
