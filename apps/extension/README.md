# Job Application Autofill (MVP)

A Chrome extension that fills Greenhouse, Lever, and Ashby applications from a saved profile, writes
free-response answers with Gemini, and stops for your review. It never clicks Submit. There is no
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

The manifest includes a public key, so the extension ID is always `kjepjmmbimmbpdfinkippakkmhbglccc`.

## Google Sheets tracking (optional)

Sheets sync needs a Google OAuth client. Filling works without it.

1. In Google Cloud Console, create a project and enable the **Google Sheets API**.
2. Configure the OAuth consent screen (External, add yourself as a test user) with the
   `https://www.googleapis.com/auth/drive.file` scope.
3. Create an OAuth client ID of type **Chrome Extension** with item ID `kjepjmmbimmbpdfinkippakkmhbglccc`.
4. Copy `apps/extension/.env.example` to `apps/extension/.env`, set `WXT_GOOGLE_CLIENT_ID`, and run `npm run build` again.

Then use **Sign in with Google and create sheet** in onboarding or Settings → Connections.

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

## How it works

| Part | Where |
| --- | --- |
| Background worker: holds the Gemini key, calls Gemini and Sheets, owns IndexedDB | `entrypoints/background.ts` |
| Content script: scan → classify → fill → free responses → verify → watch for new fields | `entrypoints/content.ts`, `lib/autofill/` |
| Side panel: paste a link, fill the current page, mark submitted | `entrypoints/sidepanel/` |
| Onboarding and settings | `entrypoints/onboarding/`, `entrypoints/options/` |

Field classification is adapter mappings (`lib/autofill/adapters.ts`) first, then label rules
(`lib/autofill/classify.ts`). Option matching (`lib/autofill/match.ts`) leaves a field empty rather
than guessing. Anti-bot puzzle questions and consent checkboxes are always left to you.

Degree matching recognizes common bachelor's spellings and abbreviations (such as BS, B.S., BSc,
BA, and BBA) in saved profiles and dropdown options. Specific qualifications stay distinct: BS
matches Bachelor of Science rather than Bachelor of Arts. If a saved generic Bachelor's Degree has
multiple specific choices such as BA and BS, the extension leaves that choice for your review.

Safety: the engine refuses to interact with submit controls, and cancels any form submission that
fires while it is dispatching events. Voluntary self-identification answers and contact details are
never sent to Gemini.

## Tests

Run from the repository root:

```bash
npm run typecheck
npm test          # unit tests against fictional Greenhouse, Lever, and Ashby forms in tests/fixtures
npm run test:e2e  # builds, then drives the real extension in Chromium (hermetic: no real sites)
```

## Not in the MVP yet

Generic fallback for unknown sites, Workday, Gemini classification of
unrecognized labels, saved-answer reuse and a Regenerate button, passive submit detection and
auto-marking Abandoned, an offline Sheets write queue, and multiple profiles.
