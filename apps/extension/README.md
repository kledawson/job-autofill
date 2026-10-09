# Job Application Autofill (MVP)

A Chrome extension that fills job applications from a saved profile (Greenhouse, Lever, Ashby, Workday,
and any other careers site), writes free-response answers with Gemini, and stops for your review. It never clicks Submit. There is no
backend: everything lives in the browser.

## Install (unpacked)

From the repository root:

```bash
npm install
npm run build
```

In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick
`apps/extension/dist/chrome-mv3`. Onboarding opens automatically. For live reload while developing,
run `npm run dev`.

After building, reload the extension in `chrome://extensions`. New installations use
`apps/extension/dist/chrome-mv3`. Existing installations pointing at the original
`apps/extension/.output/chrome-mv3` folder are also updated by `npm run build`, preserving
the extension ID and Chrome's saved profile data. Reopen Settings to see the updated UI.

The manifest includes a public key, so the extension ID is always `kjepjmmbimmbpdfinkippakkmhbglccc`.

## Google Sheets tracking (optional)

Sheets sync needs a Google OAuth client. Filling works without it.

1. In Google Cloud Console, create a project and enable the **Google Sheets API**.
2. Configure the OAuth consent screen (External, add yourself as a test user) with the
   `https://www.googleapis.com/auth/spreadsheets` scope.
3. Create an OAuth client ID of type **Chrome Extension** with item ID `kjepjmmbimmbpdfinkippakkmhbglccc`.
4. Copy `apps/extension/.env.example` to `apps/extension/.env`, set `WXT_GOOGLE_CLIENT_ID`, and run `npm run build` again.

If this build has no OAuth client ID, pasting a link and choosing **Connect sheet** now shows the one-time setup steps instead of leaving the button disabled. A spreadsheet link alone cannot configure Google sign-in.

Then, in onboarding or Settings → Connections → Google Sheets tracking:

Create a sheet in Google Sheets, paste its link, and choose **Connect sheet** and approve access. There is nothing
else to configure: the sheet's headers decide what is saved.

When you click **Mark as submitted** in the side panel, one row is added to the tab selected in your pasted link (or the first tab when the link has no tab ID), in the topmost row with
no company or position, and the side panel shows the row number with a link. The extension reads the header row and
fills the columns it recognizes, whatever their order: company name, position, date applied (and a "Found" column,
which gets the same date), link, location, work model, base pay (the pay range posted on the job page, when it
has one), and application status (set to "Applied"). Other columns, such as Referral or Next action, and cells
such as dropdowns are left alone, and a detail with no matching column is skipped. If the sheet is empty,
those headers are written first. Existing values and formulas are preserved. Keep a Posting URL column so retries can recognize a previously written application. Nothing is written when an application is only filled. If the write fails, the
side panel offers **Retry adding to sheet**.

Connections shows the linked tab name. **Test connection** reads its headers through the extension’s OAuth connection without adding a row. A renamed tab keeps working because its numeric ID is saved; a deleted tab requires reconnecting. Existing connections without a tab ID use the first tab until tested or reconnected.

## Gemini (optional)

Create a free key at [Google AI Studio](https://aistudio.google.com/app/apikey) without enabling billing,
and paste it into onboarding or Settings → Connections. The default model is `gemini-flash-latest`;
you can change it there. Without a key, free-response questions are outlined for you to answer.

Setup can fill empty profile fields from your PDF resume (**Fill my profile from resume**). The resume
is read on your computer with [pdf.js](https://mozilla.github.io/pdf.js/): name, contact details, links,
current position, education, experience, and skills. Contact details are reliable; the other sections are
best-effort because layouts vary. If a section isn't found (or the PDF is a scan), you can have Gemini read
just that part, which sends the resume text to Gemini. Work authorization, preferences, and
self-identification are never inferred.

## Supported sites

| Site | How |
| --- | --- |
| Greenhouse, Lever, Ashby | Dedicated adapters; the content script loads automatically. |
| Workday (`*.myworkdayjobs.com`, `*.myworkdaysite.com`, `*.myworkday.com`) | Loads automatically. Workday applications span several pages (My Information, My Experience, Application Questions, Voluntary Disclosures, Self Identify). Click **Fill this page** (or open a pasted link) once: each page is filled when it opens, and the sign-in page is left alone. On My Experience, one Work Experience and Education entry is added per profile entry, then filled. Save and Continue is always yours to click. |
| Any other site | The generic adapter reads labels, `autocomplete`, and the page's schema.org JobPosting data. The first time you fill a page outside the sites above, Chrome asks to let the extension **read and change data on all sites** (an optional permission). The extension only reads a page when you click **Fill this page** or open a pasted link; you can remove the permission in `chrome://extensions`. |

When a Gemini key is set, questions no label rule recognises are sent to Gemini **as wording and option
text only** to ask which saved profile fact answers them (or none). The value still comes from your
profile, the field is outlined in blue for review, and the answer is cached locally per question wording.
Acknowledgements, consents, and "how did you hear about us" style questions are never answered this way.

## How it works

| Part | Where |
| --- | --- |
| Background worker: holds the Gemini key, calls Gemini and Sheets, owns IndexedDB | `entrypoints/background.ts` |
| Content script: scan → classify → fill → free responses → verify → watch for new fields | `entrypoints/content.ts`, `lib/autofill/` |
| Side panel: paste a link, fill the current page, mark submitted | `entrypoints/sidepanel/` |
| Onboarding and settings | `entrypoints/onboarding/`, `entrypoints/options/` |

Field classification is adapter mappings (`lib/autofill/adapters.ts`) first, then label rules
(`lib/autofill/classify.ts`), then optional AI matching (`lib/field-map.ts`). Fields under a numbered
heading ("Work Experience 2", "Education 1") map to that profile entry. Option matching (`lib/autofill/match.ts`) leaves a field empty rather
than guessing. Anti-bot puzzle questions and consent checkboxes are always left to you.

Degree matching recognizes common bachelor's spellings and abbreviations (such as BS, B.S., BSc,
BA, and BBA) in saved profiles and dropdown options. Specific qualifications stay distinct: BS
matches Bachelor of Science rather than Bachelor of Arts. If a saved generic Bachelor's Degree has
multiple specific choices such as BA and BS, the extension leaves that choice for your review.

## Remembered mappings

1. Fill an application. Answer a missing question on the page; its review card remains available.
2. Answered cards turn indigo and offer **Save this answer**; empty cards stay white with **Remember answer**.
   Clearing the page answer returns the card to its empty state. Select the button to capture only that
   field's current answer. Confirm the preselected
   answer, or choose an available dropdown option in the panel if the page field is still empty.
3. Confirmation shows **Update profile** for a supported fact, such as an exact GPA for a known education
   entry. Choose **Save to profile** and confirm replacing any different existing value. No separate Memory
   is created. Ambiguous education entries, GPA ranges and unknown scales remain Memories.
   Custom answers show **Reuse for**: All applications or This application; **More limits** reveals
   company/website restrictions. Contextual answers default narrowly.
4. For a Memory, click **Save & apply**. It saves locally and writes only that empty selected field. Existing page
   answers are preserved. A changed/rerendered field requires a fresh capture, while the memory remains safe.

To remember several questions at once:

1. Wait for autofill to finish, then answer the remaining review questions on the application page.
2. Click **Save all answered questions (N)** above the review list. The button becomes active as you answer.
3. Review each **Update profile** or **Create memory** destination, replacements and reuse scopes.
   Uncheck any you want to leave out.
4. Click **Save N answered questions** (or **Remember N answered questions** for a memory-only batch) once. Your page answers stay as you entered them.

Only answered questions in the review list are captured, up to 100 per batch. Empty or unreadable fields
are skipped. If an answer changes while you review, cancel and capture again. A conflicting existing
answer stops the entire save; exclude that question or edit its record in **Settings → Memories**.
Equivalent existing answers reuse their records without removing approved variations.

The sidebar keeps capture and Save all available. **Manage Memories in Settings** opens the searchable
library. **Edit** opens inside its card. **Delete** uses the same confirmation dialog as documents and
profile entries; Cancel or Escape keeps the record. Current page answers stay intact.

**Settings → Memories** offers inline card editing plus **Add memory**, answer-type filters and sorting
by update, question or use date. Search accepts multiple words across question wordings, answers,
alternate choice labels, profile details and companies; case and accents do not matter. Result counts,
**Clear filters**, empty states and dismissible notifications explain each action. Filters stay disabled
while editing so a draft cannot vanish. Existing `#knowledge` bookmarks open Memories.
Saving is explicit; page edits are not silently collected. Profile changes appear in an already-open
Settings window when there is no unsaved draft. Concurrent changes block saving an older draft.
All applications still requires a matching approved question; narrower scopes allow contextual exceptions.

Recognised question meanings reuse locally with country, timeframe, subject, education-level and
negation checks. Unfamiliar wording offers **Review suggestion**; compare the old/new questions and save
to approve the alias. **Improve future matching** groups optional controls by purpose:

- **Other ways this question is asked**: add/edit/remove individual question wordings with **Add wording**.
- **Other labels for this answer**: approve equivalent dropdown choices with **Add answer label**.
- **Keep this answer linked to my profile**: choose a profile detail and see its current value.
  Linked answers follow future profile edits; fixed-answer labels do not apply to changing profile values.
- **Edit original question** changes the question itself. To preserve it, add another wording instead.

**Try a variation** tests an unsaved draft locally against the same question index and option rules used
by autofill. Enter a sample question, optionally its complete dropdown choices, and optionally a different
company/application URL to check scope. The result explains **Would autofill**, **Would ask you to confirm**,
or **Would skip**. Editing the draft or example clears the old result. This is a matching preview, not a
guarantee that an unsupported widget can be filled; page values and verification are still checked.
It does not save, read a page, or call AI.

The optional **Get optional AI suggestions → Suggest question variations** helper sends only the question
to Gemini. AI proposals require individual approval and are never required for autofill.
Application scope wins over company, site, legacy platform, then global. Conflicts skip reuse. Profile
links read the latest saved fact; empty facts remain unanswered. Older mappings keep exact-only behavior
until edited and equivalent-question reuse is confirmed. Company scope uses normalised adapter metadata;
choose application scope when uncertain. Site scope can cover multiple employers on a shared ATS host.

Remembered values are filled before AI free responses, including conditional follow-up fields. Literal
dropdown answers accept exact/approved equivalents, unambiguous Yes/No options, BS/B.Sc./Bachelor of Science
and small tested category dictionaries. Unknown or ambiguous options stay manual. Files, standalone
checkboxes, consent controls, and anti-bot challenges stay outside remembered mapping
support. Review the resulting application before submitting.
Native multiple-select lists, clearly labeled checkbox groups, and supported React-select dropdowns can
remember several choices together. Answered cards show their selection count and **Save these answers**.
Remove-button text and search queries are excluded. In Memories, edit each selected answer and its
approved alternate labels under **Improve future matching**. **Try a variation** can also test several
choices. On reuse, every choice must have a distinct matching enabled option; missing or ambiguous
choices leave an initially empty field unchanged. A widget that rejects a later choice remains marked
for review. Existing selections are preserved. Workday multi-select prompts and profile-linked lists
are not supported by this feature yet.
Repeatable entries beyond the first use per-entry profile matching rather than generic remembered answers.

Mappings live in the extension's local IndexedDB. They are separate from profile JSON import/export
and are removed by **Delete all local data**. No additional permission, dependency, backend, or AI key
is required. After rebuilding, reload the extension and refresh the application tab to use the new code.

Safety: the engine refuses to interact with submit controls, and cancels any form submission that
fires while it is dispatching events. Voluntary self-identification answers and contact details are
never sent to Gemini.

A confirmed profile update can relink the matching fixed-answer Memory to the profile. The confirmation
shows this change; its ID, approved wording, scope and usage history stay intact. Concurrent edits reject
the save. Unrelated Memories are not migrated. GPA options use exact numeric scores or a single
compatible range; overlapping ranges and different scores remain manual.

## Tests

Run from the repository root:

```bash
npm run typecheck
npm test          # unit tests against fictional Greenhouse, Lever, Ashby, Workday-style, and careers-site forms
npm run test:e2e  # builds, then drives the real extension in Chromium (hermetic: no real sites)
```

## Planned improvements

An offline Sheets write queue and multiple profiles remain future work.

## Backup and restore Memories

In **Settings → Memories**, select **Backup Memories** to download a dated JSON file containing all
Memories, including items hidden by search or filters. The file preserves approved question variations,
answer labels, multi-select choices, Profile links, reuse limits and usage dates. It excludes your
Profile values, documents, application history and connection credentials. Back up the Profile
separately in **Settings → Data**. Treat the backup as personal data because it contains your answers.

To restore, select **Restore Memories** and choose that file. The review separates **Different versions**, **New Memories**, and **Already saved**. Compare saved
and backup answers side by side. Conflicts default to **Keep my saved answer**; choose **Use the backup
answer** only where you want a replacement. New items are selected by default; uncheck them or choose
**Skip all new** to exclude them. Identical items need no action. Review the added/replaced counts,
then select **Apply these choices**. With no changes selected, use **Finish without changes**.
**Cancel restore** changes nothing. The saved library is hidden during review so pending choices cannot
be confused with answers already saved.
Overlapping rules that share existing Memories are grouped under one choice so keeping a Memory
cannot remove it through another override. This merges selected items; unrelated existing items stay saved.

Profile links use the destination browser’s current Profile; they do not copy old Profile values.
Local record IDs are regenerated. Legacy exact-wording rules remain exact-wording rules; restoring
does not approve new variations or broaden reuse limits. Reimporting identical rules creates no duplicates.

Files must use backup format version 1, contain at most 1,000 Memories and fit within 5 MB. Malformed
or internally conflicting backups are rejected before saving. If another window edits Memories after
the preview, refresh the preview and review the choices again. All selected changes commit together.

Backup/restore runs in the Settings page, so an older running background worker cannot prevent the
file download. After rebuilding, reload the extension and reopen Settings to load the updated controls.
