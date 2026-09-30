# RTEC PHC Field Reporting — offline app (no SharePoint)

This is a **different architecture** from the rest of this repo, not a piece of
it. The `scripts/` and `docs/` folders build the SharePoint + Power Apps +
Power Automate stack from the original playbook. This folder instead is a
**standalone offline web app** that does the same field-capture-to-PDF job
without SharePoint, Power Apps, Power Automate, or Microsoft licensing —
built because SharePoint admin access wasn't available.

It's a **PWA** (Progressive Web App): plain HTML/CSS/JS, installs to an
iPhone/iPad home screen from Safari, works with zero network connection once
loaded, and needs no Mac, no Xcode, and no App Store. Nothing here requires
Apple Developer Program membership.

## What it does

Walks a technician through the same visit → findings → report flow as the
playbook (section 2–4), entirely on-device:

1. **Start Visit** — SingleOps Visit ID, visit type, client, property, technician, date/time. (No contract number field — removed on request; it isn't collected or printed anywhere.)
2. **Work Performed** — services performed; a repeatable **Plant/Area → Conditions** sequence (add one plant or area, pick its conditions, save, add the next — not one big form for the whole visit); treatment details; follow-up notes.
3. **Findings** — a photo (camera or photo library), plant/area, location, observation, recommendation, priority, arborist-review flag. Repeatable, and **always offered** regardless of visit type — see "Photo prompts" below.
4. **Review & Submit** — generates a PDF **on-device**, no server round-trip: Page 1 always (with the real RTEC letterhead — logo, address, phone); **embedded-photo finding pages** appended only when findings exist — the same output rule as the playbook's decision table (section 4). No SOP is ever rendered into the PDF.
5. **Share** — hands the finished PDF to iOS's share sheet (Save to Files, AirDrop, Mail, or straight into SingleOps if a share extension for it exists on the device) or a plain download as a fallback.

All visit and finding data — including original photos — stays in the
browser's on-device database (IndexedDB) until you export a report. Nothing
is sent anywhere by this app; there's no backend, because there is no backend.

## What's sourced from RTEC's real branding and PHCI Visit Report PDF

The **Services Performed** and **Ornamental Pests / Conditions** choice
lists, the **Other — Specify** field, and the letterhead's address/phone/
website text are pulled directly from RTEC's actual, currently-used PHCI
Visit Report PDF (OneDrive: *Plant Health Care Department/SOPs/PHCI
Reporting/RTEC PHCI client visit report.pdf*) — the playbook itself never
enumerated the service choices, and `Ornamental Pests / Conditions` /
`Other — Specify` aren't in the original playbook's field table at all;
they're included because the real form requires them.

The **logo** (`assets/logo.jpg`) is RTEC's real mark, found in OneDrive at
*Documents/rtec email logo.jpg* — a proper source asset, not extracted or
approximated from the PDF. It's embedded on Page 1 of every generated
report (full size) and as a smaller running-header mark on subsequent
finding pages.

**Photo handling itself follows the original build playbook, not that PDF.**
The real PDF's Page 2 is actually a different thing — a text-only log,
capped at 5 photos, that are labeled and uploaded to SingleOps separately.
An earlier draft of this app mistakenly adopted that whole model; that was a
misreading of what the PDF was being provided for (choice lists, not a
photo-handling redesign) and has been reverted. Findings here are
unlimited, and each one gets its **photo embedded directly into its own
report page**, as the playbook specifies.

## Photo prompts are always offered, on every visit type

The original build playbook only offered the finding/photo entry point on a
Landscape Inspection, or on a Targeted Treatment visit with the pressing-
issue or arborist-requested-photos flag set — a routine Targeted Treatment
visit had no way to attach a photo at all. On request, that gate is gone:
**"+ Add Finding" is always available**, regardless of visit type or either
flag. Those two flags still exist and still drive arborist-review routing
(`phc-logic.js`'s `requiresArboristNotice`) — only the *photo entry point's
visibility* changed.

## Plants/Areas and Conditions are entered as pairs, not one big form

Work Performed used to have one free-text "Plants / Areas" box and one
checklist of "Ornamental Pests / Conditions" shared across the whole visit —
there was no way to tell which condition applied to which plant. It's now a
repeatable sequence, same pattern as Findings: **add one plant/area, pick
its conditions, save, add the next** (a dedicated screen, same as adding a
finding). The generated PDF renders these as a **two-column table** (Plant /
Area — Ornamental Pests / Conditions) so they line up for scanning, instead
of two separately-listed paragraphs a reader has to mentally cross-reference.

## Report ID

The report identifier — shown in the app and printed on the PDF — is
**`<SingleOps Visit ID> PHCI Report`** (e.g. `SO-12345 PHCI Report`),
computed on demand from `visit.singleOpsVisitId` (`phc-logic.js`'s
`reportId()`) rather than a separately generated/stored value. Computing it
on demand means it can't go stale if the SingleOps Visit ID is corrected
after the visit was first created — there's nothing to fall out of sync.
The PDF filename uses the same identifier with spaces turned to hyphens.

## PDF formatting — current state

- **Logo**: 72pt tall on Page 1, 28pt on the running header on later pages.
- **Section headings** have a real leaf-green color bar spanning the full
  content width beneath them (not a thin grey hairline), on every page —
  including where a section's own content overflows onto a new page, where
  it redraws as "*Section Name* (continued)" so the visual thread doesn't
  just stop mid-paragraph.
- **The Flags section is omitted unless there's actually a pressing
  issue.** A routine visit doesn't print a "No / No" section that would
  tell the reader nothing.
- **No top-of-report arborist notice.** That context now lives only on the
  specific finding that triggered it (see below) — more precise than a
  blanket statement at the top of the report when only one of several
  findings is the reason.
- **Per-finding arborist tag**, shown only on a finding with
  `arboristReviewRequired` set, in orange: *"Arborist has been notified of
  this finding. Please contact for further RTEC action."* Wrapped safely
  regardless of length, same as the (now-removed) top-of-report note was.
- **No cap on findings or photos** — confirmed with a 12-finding visit
  generating correctly (19 pages, 91ms) rather than just asserting it.
- **One finding per page**, photo included. (An earlier round briefly
  tried two per page; reverted.) The photo's size **adapts to how much
  text comes with it** — `pdf-report.js` estimates the wrapped height of
  that finding's Plant/Area, Location, Observation and Recommendation text
  first, then sizes the photo to fill whatever room is left (bounded
  140–480pt), so a finding with a short observation gets a big photo and
  one with a long one still fits on the same page. An unusually long
  finding can still spill onto a second page — normal overflow, not a bug.
- **No separate "enlarged" copy of the photo.** An earlier round added a
  second full-page copy of each photo elsewhere in the PDF with a tap-to-
  jump link, specifically so it could be viewed bigger. That's gone —
  removed along with the link-annotation code it needed. With one finding
  per page and an adaptively-sized (often quite large) inline photo, any
  standard PDF viewer's native pinch/scroll zoom on that single embedded
  image does the same job without doubling the page count.
- **Photo capture offers the photo library, not just the camera.** The
  finding photo field used to force the camera open directly
  (`capture="environment"`), with no way to pick an existing photo. Removed
  — the native picker now offers both "Take Photo" and "Photo Library."
- **Finding photos are always embedded right-side-up, and the finished PDF
  is always kept under 2.0 MB.** pdf-lib embeds a JPEG's raw pixel bytes
  and ignores its EXIF orientation tag, so a portrait phone photo (stored
  as landscape pixels + a "rotate" flag) previously showed up sideways in
  the PDF even though its in-app preview looked correct (the browser
  auto-rotates `<img>` previews using that same tag). `pdf-report.js` now
  decodes each photo into an `<img>` element first — which applies the
  correct rotation — then re-encodes it through a canvas before handing it
  to pdf-lib, so the corrected orientation is baked into the pixels
  themselves. That same re-encode step is reused to enforce the size
  budget: the whole PDF is built at a starting photo quality/resolution,
  and if the result is over 2.0 MB, it's rebuilt at progressively lower
  photo quality/resolution (a fixed ladder, largest first) until it fits.
  Verified with a synthetic EXIF-rotated test photo (embedded image came
  out in the corrected orientation, confirmed pixel-by-pixel) and with 8
  worst-case, poorly-compressible 11 MB source photos in one report (final
  PDF: 1.89 MB, ~2.2s).

## The one thing this can't automate: SingleOps upload

SingleOps's only public API creates leads — there's no documented API for
attaching a file to an existing job. The playbook already assumed this
("the existing SingleOps handoff remains manual unless a separately approved
integration method is provided"), and that hasn't changed here: getting the
generated PDF into SingleOps is a manual step — share it into Files, then
upload from there. If SingleOps support confirms an undocumented
attachment API exists, that's worth revisiting, but it can't be assumed.

## Deploying it

A real installable, offline-capable PWA needs **HTTPS hosting** — iOS Safari
won't register a service worker (what makes offline work) over `file://` or
plain `http://`. Opening `index.html` directly by double-clicking will *not*
give you the offline/installable behavior; it needs to be served.

Two free, no-admin-required options:

**GitHub Pages** (if RTEC or you have any GitHub account):
1. Create a new repo, push the contents of this `ios-app/` folder to it.
2. Repo Settings → Pages → Deploy from branch → `main` / root.
3. Wait a minute, then open the given `https://<user>.github.io/<repo>/` URL on the iPad.

**Netlify** (no git needed):
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag the `ios-app` folder onto the page.
3. Open the given `https://<random-name>.netlify.app` URL on the iPad.

Either way, once you have an `https://` URL, open it in **Safari on the
iPad** (must be Safari, not Chrome — Chrome on iOS can't install to the home
screen) → Share button → **Add to Home Screen**. It now behaves like an
installed app: its own icon, full-screen, no browser chrome, and works with
the iPad in airplane mode.

## What's been verified, and how

No Node.js or Mac was available in the build environment, so validation ran
against the actual browser engine (Chromium/Edge) rather than a JS linter:

- **The PDF engine (`pdf-report.js`) was run end-to-end** in a real browser
  against realistic data, including embedded photos, the real logo (fetched
  and embedded as an actual 400×200 JPEG, not a stand-in), mixed-priority
  findings exercising all three priority-chip colors, multiple Plant/Area
  entries rendered as the two-column table, the arborist-notice banner, and
  both output branches (Page 1 only vs. Page 1 + one embedded-photo page per
  finding). Every run produced a valid PDF byte stream (`%PDF` header,
  correct filename pattern, page count matching one page per finding). This
  pass also confirmed `drawEllipse` (used for the priority chips) is
  actually present in the vendored pdf-lib build before relying on it.
- **Section-heading continuation was verified with deliberately long text**
  (not just short samples) that forces a genuine multi-page overflow within
  Page 1's content — confirmed the section band actually redraws on the new
  page rather than just trusting the logic by inspection.
- **The conditional Flags section** was verified both ways: a
  `pressingIssueObserved: true` run produces a larger PDF (confirming the
  section and its banner render) than the otherwise-identical `false` run.
- **`canAddFinding` was verified to return `true` for every visit shape
  tried** — including a bare Targeted Treatment visit with neither flag set,
  which used to be exactly the case it returned `false` for.
- **The report-ID derivation** was checked directly: derives correctly from
  `singleOpsVisitId`, falls back sanely when blank, trims whitespace, and
  the generated PDF's own title/footer and the exported filename all use
  it consistently.
- **One-finding-per-page and the click-to-zoom removal** were both
  confirmed structurally, not just eyeballed: a 3-finding report reloaded
  with pdf-lib has *exactly* 4 pages (1 page-1 + 3 findings, no doubling
  from appendix pages), and a full scan of every page's `/Annots` array
  found **zero** Link annotations anywhere — the link-annotation code
  itself is gone, not just unused.
- **12 findings generate correctly with no cap**, confirmed at the top of
  this same round of changes (19 pages, 91ms) and unaffected by the
  1-per-page revert.
- **All decision logic (`phc-logic.js`)** — the arborist-routing rule, the
  page-output label, the add-finding visibility rule, and every validation
  function — was run with both passing and failing inputs and matched
  expected results in every case.
- **The full app (`index.html` + `app.js`) loads and initializes without
  error** when served over HTTP — confirmed no syntax errors anywhere in the
  load chain and that the app reaches its home screen.

**Not verified: `db.js` (the IndexedDB layer) against a live database.** The
sandboxed headless browser available in this environment could not complete
even a bare, code-free `indexedDB.open()` call — it hung rather than erring,
which points to a sandbox/storage-backend limitation of that specific test
environment, not a code defect (everything downstream of IndexedDB was
proven correct by feeding the PDF engine hand-built data of the same shape
`db.js` produces). Real Safari on an actual iPad does not share this
limitation. Still, **this is the first thing to check in the field pilot**:
create a visit, force-quit Safari (or the installed app), reopen it, and
confirm the draft is still there. If it isn't, that's a real db.js bug this
environment couldn't catch — come back and it can be fixed.

## Known limitations, by design or by scope

- **No sync, no backup.** Data lives in that one browser's storage on that
  one device. There's no multi-technician visibility, no office dashboard,
  and no automatic backup. If the device is reset or the browser's site data
  is cleared, unsent visits are gone. Export/share reports promptly.
- **iOS can evict site storage under pressure**, same as any PWA (not unique
  to this app) — installed home-screen apps are less likely to be evicted
  than a regular Safari tab, but it isn't an absolute guarantee the way a
  native app's storage is. Don't let days of unsynced visits pile up.
- **No arborist email routing — worth reading carefully.** This app has no
  backend and sends no mail. Any finding with `arboristReviewRequired` set
  prints, in orange, *"Arborist has been notified of this finding. Please
  contact for further RTEC action"* — stating as fact something only a
  human sending that email actually makes true. It describes the required
  manual step (the technician forwards the report, same as the real Field
  Technician SOP already expects), not something this app performed.
  Routing the copy is still entirely on the technician (share → Mail, or
  Files) — the app surfaces the on-screen flag but never confirms the
  email was sent, and has no way to.
- **Object URLs for photo previews aren't explicitly revoked** after use.
  Not a problem for a single visit's worth of findings; could matter if a
  single session runs very long without ever reloading the app.

## Field test checklist

The same scenarios as the playbook's iPad Acceptance Test Script (section 8),
adapted for this app:

- [ ] **Targeted Treatment, no exception** → "+ Add Finding" is still offered (this changed — see "Photo prompts are always offered"); if skipped, Page 1-only PDF and no Flags section.
- [ ] **Targeted Treatment, pressing issue** → Flags section appears on Page 1; no top-of-report arborist note (removed on request).
- [ ] **A finding with "Arborist review required" checked** → orange notice appears on that finding's page only ("Arborist has been notified of this finding...").
- [ ] **Landscape Inspection, 3 findings** → all 3 appear as separate pages, one finding + its photo per page, photo sized to fit alongside its text.
- [ ] **Multiple Plant/Area entries** → each renders as its own row in the Page 1 table, plant/area and conditions aligned in their own columns.
- [ ] **Report ID** — matches `<SingleOps Visit ID> PHCI Report` on-screen and on the PDF; editing the SingleOps Visit ID before submitting updates it everywhere.
- [ ] **Reopen draft** — start a visit, force-quit the app, reopen, confirm data is still there. *(See the db.js note above — check this first.)*
- [ ] **Share report** — generated PDF opens/shares correctly via the iOS share sheet.
- [ ] **Airplane mode** — turn on airplane mode, force-quit and reopen the app, complete an entire visit start-to-PDF with zero connectivity.
- [ ] **Missing required field** — leave something blank, confirm the app blocks submission with a clear message.
- [ ] **Photo picker** — tapping the Photo field on a real device offers both "Take Photo" and "Photo Library," and both actually attach a photo.
