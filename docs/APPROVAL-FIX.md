# Approval blocker repair — 7 November 2026

## Cause and repair

The reported property `6aed43e11345b9c67d75b2f3` was submitted, had complete required fields and photo permissions, and belonged to an active owner. Its authorization document was `quarantined`, with scan engine `not-configured`. The development server had no `CLAMD_HOST`. The approval route correctly refused publication, but the review page hid security scanning at its bottom, attempted to preview quarantined documents and did not explain the blocker upfront. An unconfigured rescan also redirected without a successful scan.

The local environment now has the official ClamAV 1.4.6 LTS Windows distribution, current signed definitions downloaded/validated by FreshClam, a daemon bound only to loopback, and a foreground FreshClam updater checking 12 times per day and notifying the daemon. Private documents remain local; no third-party document submission service is used. The development `.env` now configures `CLAMD_HOST` and `CLAMD_PORT`. Production still uses the private Docker scanner described in `PRODUCTION.md`.

After a hash-verified cold backup of the preview database, the reported document's stored SHA-256 was verified and its stored bytes passed the real scanner. Only scan metadata was updated; the listing remains `submitted`, and human document review remains `pending`. An operator-origin `document.scan` audit event records the repair. No authenticity, issuer check or human approval was invented, and no accounts, listings, photos or documents were deleted.

## Admin workflow

1. Log into the admin account and reopen the property's review page.
2. Check the approval checklist. The reported property is now ready for admin review.
3. Open the authorization document and review its issuer, validity, holder and property details. Review all photographs and publication permissions.
4. Tick both property/photo review and authorization-document review confirmations. Coordinate review is optional when no exact property pin will be published.
5. Click **Approve & publish PG**. Successful approval creates the approved snapshot and makes the property visible in student search and detail pages.

For future quarantined documents, use **Run security scan** first. Missing/unavailable scanning remains a blocker; it must never be replaced by an unconditional clean result.

## Files changed

| File | Reason |
| --- | --- |
| `lib/admin-review.js` | Compute approval blockers and render an authenticated review page with active-owner, required-data, photo and document-scan checks. |
| `app.js` | Use the review renderer; expected decision/scan errors remain on the review page with admin input preserved. |
| `routes/operations.js` | Unconfigured/incomplete rescans return an explicit failure instead of redirecting as if successful. |
| `views/review.ejs` | Visible checklist, scan states, disabled blocked approval, no previews of quarantined files, review anchors, preserved notes, and a public-listing link after publication. Existing decisions, additional checks, reports and history remain. |
| `public/inner.css` | Scoped review-page styling using the current visual design. |
| `tests/production.test.js` | Regression coverage for the exact quarantined/unconfigured failure, safe previews, review confirmations, preserved input and eventual public visibility. |
| Local `.env` | Configure the local scanner host/port; existing settings retained. No secret values are included here. |

## Actual verification

- Full suite: **78 passed, 0 failed**. The first run had one transient local HTTP `ETIMEDOUT` during an existing document privacy test while scanner definitions were being installed; the complete rerun passed.
- Lint passed. Build passed: 44 JavaScript sources and 35 EJS templates.
- Real ClamAV engine: harmless input accepted, standard EICAR antivirus test rejected in memory. No EICAR data was attached to a real listing or saved as a property document.
- Browser, disposable database: quarantined evidence could not preview and approval was disabled; a real scan enabled review; submitting without review confirmations stayed on the page and preserved notes; explicit confirmations published the test PG; the public property page displayed its rent and two test photographs.
- The real property's scan is clean and its readiness checklist has no blockers. Its final human review/publication is intentionally pending; the real document's legal authenticity has not been independently established.
- Real admin browser authentication was not available in the agent's session. No login bypass, role change or recovery-token shortcut was introduced. Browser mutation tests used isolated accounts/data only.

## Running the local scanner after a computer restart

The current daemon/updater are background task processes, not Windows startup services. Keep them running with the preview. They must be restarted after a computer reboot or process termination; do not merely relabel files clean if the service is offline. From the workspace (the parent of `nestly`), in separate terminals:

```powershell
$scannerRoot = (Resolve-Path .\work\clamav-local).Path
$engine = Join-Path $scannerRoot 'engine-1.4.6\clamav-1.4.6.win.x64'
& (Join-Path $engine 'freshclam.exe') --quiet "--config-file=$scannerRoot\freshclam.conf"
& (Join-Path $engine 'clamd.exe') "--config-file=$scannerRoot\clamd.conf"
```

```powershell
$scannerRoot = (Resolve-Path .\work\clamav-local).Path
$engine = Join-Path $scannerRoot 'engine-1.4.6\clamav-1.4.6.win.x64'
& (Join-Path $engine 'freshclam.exe') --daemon --quiet "--config-file=$scannerRoot\freshclam.conf"
```

Do not start duplicate processes while the current scanner/updater are running. Definitions older than the existing 72-hour policy are rejected. For public deployment, use the managed/restarting Docker scanner and signature volume rather than this development setup.

Official references: [ClamAV downloads](https://www.clamav.net/downloads), [Windows and FreshClam configuration](https://docs.clamav.net/manual/Usage/Configuration.html). Source package and databases are kept under `work/clamav-local`, outside the repository and public static assets.
