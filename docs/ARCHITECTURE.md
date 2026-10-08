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

## Implemented remembered mapping flow

The running extension supports Greenhouse, Lever, Ashby, Workday, and permitted generic pages. Memories live in `apps/extension/lib/remembered-mappings.ts` (validation, scope and indexing),
`lib/answer-semantics.ts` (pure local meanings and option equivalents), `lib/db.ts` (trusted IndexedDB),
and `components/KnowledgeBase.tsx` (confirmation and management).

Verification reports full unresolved question text separately from truncated display labels. Eligible
questions offer Remember answer in side-panel cards that remain after manual entry. An explicit click
captures only that field's committed value. The editor confirms the answer and global, company,
application or site scope. Advanced aliases/profile links are collapsed. Settings → Memories
supports search, edits/removal, and last-used dates. No page answers are harvested automatically.
`MemoryLibrary` provides inline editing, confirmed deletion, search and filters in Settings. The sidebar
retains capture/batch confirmation and a Settings link; it does not browse stored memories.
Question-only `memoryQuestions` metadata remains compatible with older tracker records.
`lib/profile-learning.ts` routes explicit captures to allowlisted profile facts. Education learning/reuse
shares `lib/education-facts.ts` with entry/level checks. Confirmation shows the destination, prior value
and replacement choice. Profile updates create no fixed-answer Memory. Unknown/contextual questions
stay scoped Memories. No AI is used for routing.
Captures distinguish scalar answers and fixed selection lists. Native multiple selects, explicit labeled
checkbox groups and supported React-select chips expose committed selections without removal controls
or search queries. `lib/selection-matching.ts` resolves each saved choice independently using its approved
aliases. `lib/autofill/selections.ts` preflights the complete set, scopes widget options to the control,
preserves non-empty groups and verifies every committed label. React-select work has an eight-second
budget and can follow a uniquely identified input rerender. A partial write is incomplete, never success.

**Save all answered questions** explicitly requests capture of answered review tokens only. The background
checks tracked tab/frame/URL and validates payloads. `components/BatchRemember.tsx` shows captured answers,
individual destinations/scopes, replacement and exclusion checkboxes. Included live snapshots are checked before an atomic IndexedDB
transaction spanning profile and memories; stale captures or conflicts reject the whole save. Equivalent existing records reuse IDs
and approved aliases. Batch saving does not write page fields or harvest other answers.

Answered review cards use an indigo **Save this answer** action; empty cards remain white with
**Remember answer**. Text plus color communicates the state, and clearing the answer restores the empty
card. **Improve future matching** separates question wordings, fixed-answer dropdown labels, profile
links and original-question editing. Individual labeled rows replace newline configuration textboxes.
**Try a variation** uses `lib/saved-answer-preview.ts`, the production saved-answer index and a shared
`rememberedChoice` transformation also used by the engine. It checks the unsaved draft, saved conflicts,
scope, current profile and optional complete dropdown choices in a trusted extension context. The preview
does not contact AI, read a page, persist values or guarantee widget support. Changes invalidate its result.

For each newly scanned batch, including conditional fields, the content script requests only matching
mappings for that batch. The background validates the sender's permission, URL, tab and frame, builds a
local index from persisted records, and returns relevant exact/meaning matches or suggestion IDs. Wider
scope cannot override a narrower one; conflicts skip reuse. Question interpretation is separate from
option rendering: BS and Bachelor of Science are equivalent, whereas a generic bachelor's answer cannot
invent BS or BA. Suggestions need explicit approval of new wording. Mapping mutations require a trusted
extension page. Capture tokens bind to a live session/element/question; apply additionally checks the
captured value. Only that empty field is written, using the existing writers and read-back verification.
Remembered free responses run before Gemini. Existing page values are preserved. Disconnecting a fill
session removes its edit listeners and pending observation timers before the next attempt. The saved-answer
path has no network dependency. An explicit advanced AI button sends only the question to Gemini for up
to five optional aliases, which the user individually selects before saving. Other existing AI paths
are separate. Schema migration preserves old records as approved-wording-only until a confirmed edit.

## Spreadsheet targeting

Connections persist the numeric tab ID from the pasted URL and its current display title. Legacy
connections use the first tab until tested/reconnected; an explicit missing tab fails without fallback.
Test connection reads metadata/headers through the same Chrome OAuth path as writes. Submission writes
preserve occupied cells/formulas and unrelated columns; a matching Posting URL makes retries reuse the
existing row. Without a URL column, a lost write acknowledgement cannot always be deduplicated. No
write occurs on autofill or connection testing.
