# Architecture

## Baseline decision

The repository now contains a working, local-first Chrome extension built with TypeScript, WXT, Manifest V3, React, and Dexie/IndexedDB. Vitest/happy-dom cover autofill logic; Playwright runs a hermetic browser flow. There is no backend. Profile data and documents stay in the browser unless a user enables the optional Gemini or Google Sheets integration.

PDF resumes are read locally on demand with pdfjs-dist; optional Gemini fallback reads missing sections only after the user invokes it. Parsed sections fill empty profile fields, including Current position, and never infer eligibility or self-identification. Builds are written to `apps/extension/dist/chrome-mv3`.

## Responsibilities

| Component | Responsibility |
| --- | --- |
| Extension UI | Onboarding, profile and document management, connection settings, prompt settings, application history |
| Background worker | Message routing, Dexie storage, profile/file payloads, Gemini/Sheets API calls, notifications |
| Content script | Field scanning, classification, filling, answer generation requests, verification, conditional-field watching on HTTP(S) sites |
| Autofill modules | ATS-specific adapters, general label rules, option matching, field writers, highlighting, job identity |

## Fill flow

1. User pastes an HTTP(S) job link in the side panel or invokes fill on an already-open page.
2. Greenhouse, Lever, and Ashby forms use dedicated adapters. Other sites use general label rules, which may be less reliable.
3. Values are read from the local profile and documents. Empty fields are filled; non-empty values are preserved.
4. Free-response fields are left for the user unless an optional Gemini key is configured. With a key, a filtered profile summary and job context are sent to Gemini and the returned draft is written to the empty field for review.
5. Saved gender, Hispanic/Latino, race, and veteran choice fields fill when the profile enables them. Other identity questions, consent, and challenge fields stay manual. The engine never clicks Submit.
6. The engine reports filled and unresolved fields, tracks the application locally, and lets the user mark it submitted after doing so themselves.
7. If the user explicitly connects a Google Sheet, application rows are synchronized there.

## Reliability boundaries

The current prototype supports site-specific text inputs, textareas, selects, radio groups, checkboxes, custom dropdowns, typeaheads, and resume/cover-letter file inputs. For searchable dropdowns, typing a query is not a selection: click a matching option and verify the selected value before reporting success. Greenhouse's phone country selector uses the profile's calling code, not its residence-country name. Keep unsupported widgets visible. Handle dynamic fields, preserve non-empty values, and never automatically submit. Self-identification filling defaults off; only gender, Hispanic/Latino, race, and veteran choice fields can use enabled saved answers. Other identity questions remain manual.

Store only synthetic diagnostics in committed fixtures. Application identity should prefer platform + job ID and fall back to a normalized URL; company/title alone are insufficient.

Dropdown writers yield between focus and opening to let client UI state commit, wait for asynchronous options, and verify a selected value. Programmatic focus uses `preventScroll` to avoid jumping to offscreen fields. School searches expand supported abbreviations (SJSU and UC campus names), then retry a shorter query only using full-name matching. Each processing batch completes up to three saved-profile passes for controls revealed/replaced by uploads or selections before requesting any AI free-response drafts. This includes race revealed by a Hispanic/Latino selection. Missing-field explanations go to the tracker without applicant values; each restarted fill clears previous results before writing new ones.

Missing eligibility answers can be saved or imported from the side panel before retrying. Profile editors merge only their changed fields into current IndexedDB state, preventing stale Settings snapshots from erasing newly saved answers. A saved authorization Yes with no scope gets a specific explanation when the available dropdown requires a scope such as any employer.

## External integrations and next work

Gemini and Sheets are optional integrations. Free-response drafting uses the filtered profile summary documented in `AGENTS.md` and excludes email, phone, street address, and EEO. The separate optional resume-reading action sends raw resume text, including any contact details it contains. Let users review generated text. Review sync failure/retry behavior before relying on Sheets as the only history. Profile import validates known field shapes/enums and supports versioned partial updates; broader message and date validation remain follow-up work. A backend can be considered only for a demonstrated sync need.
