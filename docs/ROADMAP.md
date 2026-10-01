# Roadmap

## Current implementation

- Shared instructions with Codex and Claude entry points.
- Chrome extension onboarding, profile editor, JSON import/export, local resume and cover-letter storage.
- On-demand local PDF resume parsing, optional Gemini fallback for missing sections, and Current position. Build output is in `apps/extension/dist/chrome-mv3`.
- Version 2 profile exports and partial answer imports, with explicit citizenship/export/clearance answers and rule-based wording aliases.
- Greenhouse, Lever, and Ashby scanning/filling with adapters, general label-based filling on other sites, free-response prompts, missing-field status, and no-submit behavior.
- Local application history and optional Gemini drafting and Google Sheets synchronization.
- WXT build, TypeScript check, Vitest unit suite, hermetic Playwright flow, and GitHub Actions CI.

## High-priority follow-up

- Broaden runtime validation to messages and calendar/date formats; profile shape validation and backward-compatible defaults are implemented.
- Keep self-identification filling grounded in enabled, explicitly saved choices; other identity questions remain manual and visible for review.
- Document exactly what Gemini receives; keep it optional and exclude contact and EEO information.
- Review extension permissions, fill reliability, custom widgets, and ATS fixtures with fictional data.
- Improve Sheets duplicate/retry handling so local IndexedDB remains authoritative.

## Team follow-up work

Split validation/storage work from form recognition and adapter improvements. Agree on shared contracts in an issue before parallel branches.

## Product extensions

- Multi-profile support, reusable saved answers, and optional profile-specific field mappings.
- CSV export, application reminders, and richer tracker filters/history.
- Pasted job-description fit analysis grounded in verified profile facts.
- Additional site-specific adapters and controlled job-board discovery.
- Additional resume formats and improved extraction quality, retaining opt-in external parsing and runtime validation.
- Cloud sync only after users demonstrate a need for it.

## Later

Automatic application submission remains outside the product direction; the user reviews the answers and submits each application.
