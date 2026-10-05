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

Safety: the engine refuses to interact with submit controls, and cancels any form submission that
fires while it is dispatching events. Voluntary self-identification answers and contact details are
never sent to Gemini.

## Tests

Run from the repository root:

```bash
npm run typecheck
npm test          # unit tests against fictional Greenhouse, Lever, Ashby, Workday-style, and careers-site forms
npm run test:e2e  # builds, then drives the real extension in Chromium (hermetic: no real sites)
```

## Not in the MVP yet

Generic fallback for unknown sites, Workday, Gemini classification of
unrecognized labels, saved-answer reuse and a Regenerate button, passive submit detection and
auto-marking Abandoned, an offline Sheets write queue, and multiple profiles.
