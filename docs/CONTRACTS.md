# Shared contracts

These are initial design constraints. The first schema/message PR must turn them into validated TypeScript/Zod contracts before feature branches depend on them.

## Applicant profile

- `schemaVersion`: integer version for import/storage migration.
- `contact`: first name, last name, email; optional phone and structured location.
- `links`: optional portfolio, GitHub, and LinkedIn URLs.
- `education`: repeatable records with stable IDs, school, degree, and optional dates/field of study.
- `experience`: repeatable records with stable IDs, employer, title, optional dates and description.
- `savedAnswers`: explicitly authored answers with canonical meaning and optional site/question scope. Work authorization and sponsorship remain separate meanings.

Use canonical paths such as `contact.email` consistently. Define required/optional fields, date formats, unknown-field behavior, and migration failures in the schema PR. Validate before replacing the current profile; invalid imports must preserve existing data.

## Field descriptor and fill plan

Field descriptor: ephemeral field ID, input type, label, autocomplete/name/placeholder signals, visible options, and whether a value already exists. Do not retain DOM nodes in persisted records.

Fill-plan entry: field ID, profile path, proposed value, reason, and decision (`fill`, `review`, `skip`, or `unsupported`). Confidence scores are matching heuristics unless calibrated; do not present them as statistical probabilities.

Fill result: field ID and outcome (`filled`, `unchanged`, `skipped`, or `failed`) plus a non-sensitive reason. Check field identity and user edits again before writing.

## Messages

Define discriminated, versioned messages for scan, plan, apply, verification results, and tracking. Include a request ID and tab/frame context. Validate the sender and payload. Send a selected fill plan rather than the entire profile to content scripts. Define errors and stale-plan rejection explicitly.

## Tracker

Application: ID, platform/job ID when known, company, title, canonical URL, status, created/updated timestamps, applied timestamp when explicitly confirmed, and optional notes.

Initial statuses: `saved`, `in_progress`, `applied`, `interview`, `offer`, `rejected`, `withdrawn`. Do not change a status to applied based only on a fill run.

Fill attempts store counts, adapter version, and non-sensitive failure categories, not applicant values. Define deduplication and migration behavior before implementing tracking.
