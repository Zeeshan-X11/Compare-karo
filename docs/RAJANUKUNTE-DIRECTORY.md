# Rajanukunte-only PG Dekho

Updated 7 November 2026. Express, EJS, MongoDB, branding and existing portal layouts are retained.

## Service area

Rajanukunte, Bengaluru is the only selectable and publicly discoverable locality. Home navigation, filters and owner submissions use the shared service-area list. Public property queries, detail pages and photo access check the approved snapshot's locality. Pending edits cannot move an out-of-area approved property into public results. Approved Rajanukunte snapshots remain visible during significant edits, subject to existing consent, suspension and publication rules.

Yelahanka and Rajajinagar remain valid historical storage values so real records can still be inspected privately. They are not accepted by the owner input API or returned by public discovery. An explicit old-area filter returns no listings. No accounts, property records, photos or documents are deleted or relabelled.

## Sourced directory

The catalog has **13 eligible Rajanukunte entries and seven retained but excluded historical entries**. Public totals may be lower if an admin hides an entry. This is a sourced directory, not a complete census, independently surveyed boundary map, operator verification or live availability feed. Sources classify these addresses as Rajanukunte; visitors must confirm the actual location and operating status.

| Entry | Public source |
| --- | --- |
| Lifestyle PG for Ladies | [Magicbricks Rajanukunte](https://www.magicbricks.com/pg-in-rajanukunte-bangalore-pppfr) |
| New NMR PG for Gents | [Magicbricks Rajanukunte](https://www.magicbricks.com/pg-in-rajanukunte-bangalore-pppfr) |
| Mars PG for Men | [Operator](https://marspg.in/) |
| Mars Girls PG | [Operator's girls accommodation page](https://marspg.in/girls-pg-in-rajankunte-bangalore-mars-hostel-and-pg/) |
| Sai Kiran PG for Boys | [Magicpin](https://magicpin.in/Bangalore/Rajanukunte/Hotel/Sai-Kiran-Pg-For-Boys/store/1c39394) |
| M.S Girls PG | [Magicpin](https://magicpin.in/Bangalore/Rajanukunte/Hotel/M.s-Girls-Pg/store/190b543) |
| Manju PG for Boys | [Find My Hostel](https://findmyhostel.in/hostel/bengaluru/chokkanahalli/Manju-PG-for-Boys-6a44f7cf39961b076a79a9c1) |
| PVR Girls PG | [My Paying Guesto](https://mypayingguesto.com/bangalore/best-pg-in-bangalore/pvr-girls-pg/) |
| VR Boys PG | [Magicbricks](https://www.magicbricks.com/propertyDetail/vr-boys-pg-rajanukunte-in-bangalore%26pgid%3D4d42353138383537677261646532) |
| Study Home PG for Boys | [Magicbricks Rajanukunte](https://www.magicbricks.com/pg-in-rajanukunte-bangalore-pppfr) |
| Stanza Living Albury House | [Operator](https://www.stanzaliving.com/bengaluru/pg-hotel-in-rajankunte/male/albury-house) |
| Stanza Living Serov House | [Operator](https://www.stanzaliving.com/bengaluru/pg-hotel-in-rajankunte/female/serov-house) |
| Stanza Living Watford House | [Operator](https://www.stanzaliving.com/bengaluru/pg-hotel-in-rajankunte/male/watford-house) |

Source checks are dated 7 November 2026; the advertisements may be older. Selected advertised starting prices, sharing types, facilities and public business numbers are shown with explicit source/unconfirmed labels. Prices are not quotes or guaranteed all-inclusive costs. PVR rent is omitted because the source contains conflicting values. Unknown fields stay unknown. No ratings, reviews, stock property photos, precise pins, vacancies or owner accounts are invented. Separate male/female Mars entries follow the operator's separate accommodation pages and share its public business number.

The seven excluded historical entries are Zolo Hercules, Zesto Blue Pearl, Green View PG for Ladies, Anusha PG, Sapphire Ultra Luxury PG for Girls, Rudra Comforts and Venkateshwara New Executive PG for Girls. Their sources indicate another locality or do not establish a sufficiently clear Rajanukunte address. They remain in the catalog/database for moderation history, with `inServiceArea: false`. Admins cannot restore them to public visibility through the directory controls.

Name/street search escapes regex input. Category filtering and 12-entry pagination run in MongoDB. Owner-listing budget/amenity filters are not applied or falsely advertised as applying to directory advertisements. Directory entries do not expose PG Dekho inquiry/favorite/compare actions because they are not owned, approved properties. A verified owner claim/deduplication workflow is not implemented.

## Local guide and free maps

The directory includes four official references:

- [Presidency University](https://presidencyuniversity.in/contact).
- [Sai Vidya Institute of Technology](https://www.saividya.ac.in/index.php/contact-us).
- [Raksha Health Care](https://www.rakshahealth.in/contact); current services/hours must be confirmed.
- [South Western Railway's Rajankunti station reference](https://swr.indianrailways.gov.in/uploads/files/1591161631577-HELPLINE%20NUMBERS.pdf), station code RNN. This is not a current timetable.

OpenStreetMap renders the locality; [OSM relation 17417762](https://www.openstreetmap.org/relation/17417762) supplies the area bounds. Directory map links are name/address searches, not verified pins. Approved owner properties get a precise map only with reviewed coordinates and publication consent. No Google API key or billing is required; Google Maps links are ordinary external searches. OSM embeds retain attribution and lazy loading. Follow the [OSM usage policy](https://operations.osmfoundation.org/policies/tiles/); no SLA or unlimited capacity is promised.

## Safe rollout

Use Node 22.23.4 or newer 22.x. Set `MONGO_URL` to the explicitly authorized target. Tests must use disposable MongoDB, never the preview or production database.

```sh
# Offline catalog validation; no writes or database required.
npm run directory:sync

# Read-only review of records which would be hidden.
node scripts/focus-rajanukunte.js

# Explicit visibility update + directory import, with verified logical backup.
# The backup directory MUST be an absolute private directory outside the app.
node scripts/focus-rajanukunte.js --apply --backup-dir=/private/backups/pg-dekho
```

On Windows, use an absolute private Windows path for `--backup-dir`. The migration snapshots directory records and the affected listings' visibility/locality metadata into an EJSON file, verifies a read-back, then hides out-of-area public records and imports the catalog by unique slug. It preserves existing moderation, is safe to rerun, and uses updatedAt guards to skip concurrent changes. Audits identify migration actions. It does not back up credentials or copy private documents; retain normal full database/storage backups separately. Writes are not transactional across the full procedure: if interrupted, preserve its backup and review the dry run before retrying. Concurrently changed records skipped by the optimistic guard require review on the next run.

After deployment/restart, the code independently enforces scope even if a visibility migration was not run. New directory records are intentionally default-excluded until explicitly reviewed in the source catalog. `npm run directory:sync -- --apply` refreshes source fields without resetting moderation. There is no startup scrape/import.

To roll back an accidental scope migration, first stop writes, review the private EJSON, and restore only the backed-up visibility/moderation/source fields for the affected IDs. Do not wholesale restore stale user/listing collections or overwrite subsequent edits. New directory slugs should be hidden rather than deleted. Re-enabling other service areas also requires an explicit code/policy change; a hidden flag alone cannot bypass the Rajanukunte guard.

For Docker, rebuild/redeploy, then run the scripts inside the app container with a private mounted backup directory outside `/app`. Existing Atlas/session/storage/email/MFA configuration requirements remain. No new paid service or environment variable is required for this change.

## Verification record

- Full isolated regression suite: 81 passed, zero failed (7 November 2026). Initial network-blocked attempts and a stale test expectation were resolved before the passing run.
- Lint passed; production validation build passed with 46 JavaScript sources and 36 EJS templates.
- Local preview restarted on port 8080 with the existing durable database. A SHA-256 verified cold backup covered 87 files; a separate EJSON backup was read-back verified before the explicit visibility/import operation.
- Local import inserted 11 new entries, refreshed nine existing source records, hid seven excluded directory entries and two out-of-area public owner listings. Public directory total: 13; stored directory total: 20.
- Before/after preservation hashes matched for all ten user accounts and all four owner property records after excluding expected visibility, update timestamps, version counters and view statistics. No uploaded files were edited or deleted.
- Live HTTP checks passed for home, listings, directory and Mars name search. Browser confirmed 13 entries, Mars search returning two, source labels and a 390px responsive layout with 375px content/client width and no horizontal overflow. Viewport override was reset. The latest map screenshot was blank, so current external tile rendering is not claimed as verified; a larger-map fallback remains available.
- Test fixtures and load-test queries use Rajanukunte with explicit out-of-area negative cases. Scope migration tests cover approved snapshots, retained private records, moderator restrictions and idempotency.
- No production database was touched. Complete neighborhood coverage, current rent/vacancies, surveyed boundaries and operator authenticity remain unverified. No external owner was contacted.

Key files: `lib/localities.js`, `lib/filters.js`, `lib/publication.js`, `lib/service-area.js`, `lib/directory.js`, `models/listing.js`, `models/directory-entry.js`, `data/rajanukunte-directory.json`, `routes/directory.js`, `scripts/focus-rajanukunte.js`, `app.js`, the home/listing/directory EJS views and `tests/directory.test.js`.
