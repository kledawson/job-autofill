# Job Application Autofill (MVP)

A Chrome extension that fills job applications from a saved profile, writes free-response answers
with Gemini, and stops for your review. Greenhouse, Lever, and Ashby have dedicated adapters; other
websites use general field-label matching. It never clicks Submit. There is no backend: everything
lives in the browser.

## Install (unpacked)

From the repository root:

```bash
npm ci
npm run build
```

In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick
`apps/extension/dist/chrome-mv3`. Onboarding opens automatically. For live reload while developing,
run `npm run dev`.

The manifest includes a public key, so the extension ID is always `kjepjmmbimmbpdfinkippakkmhbglccc`. To inject its content script on arbitrary job sites, the extension requests access to all HTTP and HTTPS websites. Chrome may show a broad site-access warning when you load or reload it. The content script uses general labels on unsupported sites, so review every filled answer.

## Google Sheets tracking (optional)

Sheets sync needs a Google OAuth client. Filling works without it.

1. In Google Cloud Console, create a project and enable the **Google Sheets API**.
2. Configure the OAuth consent screen (External, add yourself as a test user) with the
   `https://www.googleapis.com/auth/drive.file` scope.
3. Create an OAuth client ID of type **Chrome Extension** with item ID `kjepjmmbimmbpdfinkippakkmhbglccc`.
4. Copy `apps/extension/.env.example` to `apps/extension/.env`, set `WXT_GOOGLE_CLIENT_ID`, and run `npm run build` again.

Then use **Sign in with Google and create sheet** in onboarding or Settings → Connections.

## Gemini (optional)

Create a key at [Google AI Studio](https://aistudio.google.com/app/apikey) and paste it into onboarding or Settings → Connections. The default model is `gemini-flash-latest`; you can change it there. Without a key, free-response questions are outlined for you to answer. Before connecting, note that each request sends the question and job description, company and role, plus a filtered profile summary: name, location, education, work history and bullets, skills, work mode, GitHub, and portfolio links. It excludes email, phone, address, and EEO/self-identification answers. Google may use prompts sent through its free tier to improve its models.

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
than guessing. Saved gender, Hispanic/Latino, race, and veteran choice fields fill only when enabled in Voluntary self-identification. Other identity fields, consent, anti-bot puzzles, and unknown fields remain manual.

Safety: the engine refuses to interact with submit controls, and cancels any form submission that
fires while it is dispatching fill events. Existing field values are preserved. The local history only
marks an application submitted after you click **Mark as submitted**. Email, phone, street address, and EEO answers
are excluded from free-response drafting. The optional Gemini resume-reading action sends the resume text,
including any contact details it contains; local PDF reading sends nothing.

## Tests

Run from the repository root:

```bash
npm run typecheck
npm test          # unit tests against fictional ATS and generic application forms in tests/fixtures
npm run test:e2e  # builds, then drives the real extension in Chromium (hermetic: no real sites)
```

## Not in the MVP yet

Site-specific Workday support, Gemini field classification, free-response saved-answer
reuse, passive submit detection and auto-marking Abandoned, offline Sheets retry queue, CSV export,
and multiple profiles.

## Updating and retrying

After changing source code, run `npm run build`, reload the extension at `chrome://extensions`,
and refresh the application tab. Load `apps/extension/dist/chrome-mv3` (the current build folder).

The side panel shows results from the last completed fill attempt. A new fill clears those
results and hides the list while working. Each unresolved field includes a reason: missing
saved profile data, a dropdown that could not be selected, a document to upload, or a question
that needs a manual answer. School, Degree, Discipline, and education dates use Education
settings; work authorization and relocation require explicit saved yes/no answers.
## Saved eligibility answers

Settings → Work authorization includes authorization scope, US citizenship, country of citizenship, export-control status, one active-clearance/history answer, and clearance eligibility. An explicit US citizen yes/no answer takes precedence; when it is blank, an exact saved US Citizen in Current status or Export-control status can answer citizenship questions. Residence, work authorization, and clearance eligibility do not establish citizenship. Standard aliases reuse saved facts without AI. Ambiguous wording and multiple clearance selections remain manual.

Settings → Your data → Import profile accepts version 2 `profile-patch` files. Supplied answers merge into the existing profile; education entries merge by index, and skills replace the list. Full exports/imports still replace the profile. Version 1 exports remain supported. Enable **Autofill my saved gender, Hispanic/Latino, race, and veteran answers** to reuse those choices. The switch starts off on older profiles. Blank answers remain unresolved; review saved decline choices before enabling. Disability stays manual and EEO is never sent to Gemini. Transcript upload is not supported.

When eligibility answers are missing, click **Fix saved eligibility answers** in the side panel. Enter the missing facts or use **Import saved answers (JSON)** with a partial update, then click **Save answers and retry autofill**. Reloading the extension alone does not populate these facts. Saving an unrelated change from an older Settings tab preserves newer answers imported in another tab.
