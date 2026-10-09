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

## Memories backup and restore

lib/memory-backup.ts provides the browser-independent versioned parser, complete-rule comparison,
connected conflict groups and restore-choice validation. It reuses stored-Memory validators and the
existing scope/meaning conflict checks without inferring new meanings. lib/memory-backup-db.ts
exports validated records and commits confirmed imports in one IndexedDB Memories transaction.

components/MemoryBackup.tsx presents file download, import preview, explicit keep/override choices,
new-item exclusions and completion/error feedback in Settings. These operations run directly in the
trusted Settings page against extension-origin IndexedDB, like Profile import. They do not depend on
background-message handlers or the worker build version. A SHA-256 token binds the preview to its file and
current Memories; the database snapshot is checked again inside the transaction. Usage-only updates
are allowed without invalidating the preview. Tokens require no service-worker in-memory state.
Profile links remain references to the destination Profile. No Profile/document/credential export
or remote integration is involved, and the autofill path is unchanged.

Restore review temporarily hides the saved library. Conflicts appear first with side-by-side native
radio choices and visible answers/reuse limits; answer-equivalent conflicts open matching details.
New items have explicit add/skip states and group selection controls. Exact existing rules are collapsed
under Already saved. Live added/replaced/kept/skipped counts explain the final confirmation action.

## Application presets

lib/presets.ts validates versioned role presets and resolves only presentation links over the
shared Profile. lib/preset-db.ts stores presets and immutable PDF documents transactionally.
Settings provides a guided create/edit view, duplication, confirmed deletion and explicit
Save and use feedback. The sidebar selects a preset and shows its resume filename.

IndexedDB version 4 adds presets, presetFiles, presetState and fillRuns without changing existing
tables. Default inherits shared documents and links. Initialization runs on explicit operations;
live queries only read storage. Revision checks reject stale edits, and document garbage collection
retains files referenced by another preset.

New links first open a lightweight extension-owned loading screen. Before navigating to the job
application or filling an existing tab, background binds an immutable run context to that tab
and job identity. AI reads this persisted context, never the newly selected global preset.
Frame/tab ownership and run IDs reject cross-tab or stale requests/results. Fill snapshots survive
worker shutdown and are removed when their tab closes or another explicit fill replaces them.
Recognized canonical link fields use explicit preset links before shared fixed-answer Memories.
Prepared text responses match only authored/approved exact wordings, precede Memories and AI,
and cannot override classified Profile, upload, consent or challenge fields. They use the existing
writer, length checks, preservation and read-back verification. No new network call, permission,
dependency, account or backend is introduced.

## Application review queue

The sidebar replaces single-link entry with a parsed list and configurable batches of 1–5
(default 3, maximum 100 URLs). Existing tracked jobs are excluded and can be opened for review.
Queue metadata lives in applicationQueue; one immutable document snapshot lives in queueContexts.
IndexedDB version 5 adds both tables. lib/application-queue.ts validates records and makes
pure batch decisions. lib/queue-worker.ts atomically claims independent opening/filling attempts within the current batch (maximum five),
then performs browser side effects. Opening pages register their attempt before navigation,
so a stopped service worker cannot silently reopen the same application. Parent/page handshake
races share the same transaction; only one binds the tab.

All current-batch tabs start filling independently in the background; one slow page or AI response does not hold other tabs. Known Profile and Memories fields fill before optional AI question matching and essays. Network messages are bounded and cancelled local waits ignore late results; optional Gemini requests have 45-second abort deadlines. Explicit restart invalidates the old attempt, waits for its writer to stop, and keeps manually entered values.

One preset/document snapshot is stored per queue. Each new fill combines it with the latest
Profile and current opt-in Gemini setting; its immutable fillRuns record binds tab, job, frame
and attempt. Current Memories are matched locally before AI. Pending URLs hold no document
copies and do not open browser tabs. A batch advances only when every current item is explicitly
submitted or skipped and its owned tab has closed. Submission is recorded locally before optional
Sheets synchronization, whose failure does not block the queue. No website Submit is clicked.

Pause prevents the next claim; Stop disconnects all active sessions and preserves open pages.
Queue observers update review/capture metadata but do not automatically fill later steps.
An explicit Fill this step retries through the bounded scheduler and preserves non-empty values.
Missing forms, closed tabs and bounded loading/fill timeouts require Retry or Skip. Chromium
alarms (additional alarms permission) wake durable timeout/recovery checks without keeping the
worker alive. Worker restarts reconcile state; browser restarts pause and detach previous tab IDs,
since those IDs must not authorize closing tabs in a new session. Session-owned markers restrict
closure to queue-created tabs. Previous restored pages are kept; retries open new owned tabs.

Queue-owned tabs are temporarily protected from automatic Chrome discarding while filling, then restored to normal memory management on review/cancellation. Existing pages report their build during Retry; stale content scripts request a page refresh instead of silently ignoring a new fill.

## Sidebar layout and review

SidebarSection stores validated open/closed booleans per section in extension local storage. SidebarLayout reorders keyed mounted children using native drag handles, keyboard arrows or move buttons, preserving live forms and drafts. A validated versioned local preference retains order across panels; removed IDs are ignored and newly added sections inserted before their next default neighbor. Applications is last by default; Reset order affects order only.

SidebarPreferences stores versioned, allowlisted category visibility. Hidden sections remain mounted to preserve drafts and selected presets; hiding the queue does not cancel it. Fill is always visible as the recovery action. Setup and Track are hidden by default, but can be enabled in Settings → Sidebar.

Fill holds a compact application summary; ApplicationReview holds the confirmed capture/Save all flow in a separate collapsed section with a bounded question-list scroll area. QueueCard promotes Review/Submitted, exposes failure retry, and keeps secondary actions/details under More. Setup configuration stays in Settings with a minimal unfinished-onboarding prompt in Fill. Queue link drafts use session storage. Public-settings subscriptions ignore unrelated queue/layout status changes.
