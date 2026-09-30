# Architecture

## Baseline decision

Start with a Chrome extension using TypeScript, WXT, Manifest V3, React, and Zod. Use local extension storage, JSON profile import/export, and CSV history export. Add Vitest and Playwright when implementation starts. A backend is deferred until a concrete sync or AI feature requires it.

## Responsibilities

| Component | Responsibility |
| --- | --- |
| Extension UI | Profile editing, preview, manual mappings, history, settings |
| Background worker | Validated message routing and trusted persistence |
| Content script | Extract visible field metadata, write approved values, verify results |
| Shared core | Canonical schemas/types, pure matching, fill-plan contracts |
| Platform adapter | Site-specific extraction, widget handling, and verification |

## Fill flow

1. User invokes the extension and grants access to the current application page.
2. Content script extracts field metadata without transferring the whole page.
3. Matching uses canonical profile keys and produces an explainable fill plan.
4. UI shows proposed answers, unresolved fields, and unsupported widgets.
5. User selects entries to apply; the content script receives only those values.
6. Writer checks field identity/current value, applies values, triggers appropriate events, and reads values back.
7. UI reports verified fills, mismatches, and skips. User reviews and submits manually.
8. User explicitly records application status. A fill run is not submission evidence.

## Reliability boundaries

Persist important state outside worker globals. Handle dynamic fields with bounded rescans. Revalidate target fields before applying a previously generated plan. Preserve user edits. Initially support normal text fields, textareas, and native selects; flag custom widgets, embedded forms without permissions, file uploads, and unsupported pages.

Store only synthetic diagnostics in committed fixtures. Application identity should prefer platform + job ID and fall back to a normalized URL; company/title alone are insufficient.

## Later integrations

Sheets sync should use OAuth, stable application IDs, a durable retry queue, and duplicate-aware writes. AI drafts must use verified profile facts and user review. Backend-owned secrets remain server-side. A future API can use Node/Fastify and PostgreSQL/Prisma, but neither is required now.
