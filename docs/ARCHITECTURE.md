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
8. Supported, guarded confirmation after the user's submit action or explicit user confirmation records
   application status. A fill run or submit click alone is not submission evidence.

## Reliability boundaries

Review controls additionally bind widget event dispatch to the active writer's AbortSignal. Stop fill
awaits that writer before enabling read-only review. File uploads have per-session document-role and
document/form attempt guards: replacing an input cannot replay an upload. A detected attachment is
preserved; uncertain previous attempts are left for manual inspection. Employer contact/address
metadata is extracted independently of applicant labels; these fields remain manual and cannot update
personal contact facts through Memories or optional AI matching.

Automatic submission detection records the application outcome while retaining the queue review slot.
Only explicit Continue/Submitted/Abandon or a user tab closure releases it. Detection never closes a tab.
The optional per-item resolvedUrl is an explicit user-selected application destination; url/key keep the
original posting identity. A trusted active-tab handoff cancels the prior writer, retains the prior page,
checks permissions/duplicates/capacity, and starts a new owned attempt on the selected page. Company/title
similarity cannot authorize a destination. Ordinary authentication still resumes only on its approved job.

Checkpoint 6 makes observer setup replace earlier listeners and invalidates pending callbacks on
cleanup. Disconnect also cancels optional-employer parser clearing. The overlay releases its timer,
listeners and DOM when no labels remain. Queue reconciliation revalidates token/item/attempt/session
ownership before closing a completed tab, and only detaches its tab ID once removal succeeds or the
tab is confirmed absent. Failed closure keeps capacity occupied and exposes recovery guidance.

Public version/build metadata is shown in a native expandable sidebar footer. The controlled benchmark
and checked ZIP are development/release artifacts only; they do not add telemetry or runtime permissions.
See the [supported matrix and measurement boundaries](RELEASE_REVIEW.md).

Workflow increment 3 reports bounded `fieldFeedback` metadata (tokens, question labels, status,
source and an action reason) separately from eligible Memory capture tokens. Required gaps precede
unverified writes, drafts and optional questions. Verified Profile/Memory/preset writes appear green;
AI interpretations/drafts and unreadable widgets require amber review; missing required/failed writes
are red; existing and subsequently edited page answers are neutral. Local committed-value signatures
are compared on review without being sent to the worker, persisted or used for silent learning.
Manual edits are preserved and may be explicitly captured; trusted input/change events mark an existing
optional question teachable without capturing its answer. Partial writer failures remain incomplete.

`showApplicationField` routes an explicit UI request to the tracked tab/frame/run, checks current job
identity, then locates a live token/question. It scrolls once and focuses without another scroll, never
clicking or reading a captured answer. Hidden, changed and stale targets fail with refresh guidance.
Autofill focus calls prevent scrolling and virtualized lists scroll their own container. Destination
confirmation moves into view after an explicit capture; Profile updates and scoped Memories retain
their existing atomic validation/replacement protections. Wrapping labels take precedence over nearby
headings, using nested label captions and excluding dropdown choices/textarea answers from questions.

Workflow increment 2 adds metadata-only authentication readiness before requesting a fill context.
Visible password/account and verification controls stop writing regardless of field count. OTP controls
are excluded from matching. `autofill/page-readiness.ts` shares readiness inspection between manual and
queued entry points; authentication remains manual. Standalone fills explain the next click instead of
automatically filling a newly authenticated page.

Queued waiting uses optional `waitingFor`/`resumeUntil` metadata on existing needs-action items.
The worker retains the attempt and private context while waiting, without sending it to authentication
pages. One cancellable watcher per document/attempt checks readiness. The first authorized frame must
atomically claim the original job in its session-owned tab before requesting that context. Same-tab
authentication redirects may wait, but different jobs cannot claim a writer. Wait bounds persist for
30 minutes rather than resetting after worker recovery. Stop/Skip/closure cancel the wait; other queue
slots continue. Pause holds new jobs while already opened jobs can finish signing in and filling.
New browser sessions detach old tabs as before. External login popups and unsupported redirects require
the user to return to the original application; no extra permissions or authentication automation are added.

Applicant city/location choices use the pure `pickApplicantLocation` matcher in `autofill/values.ts`.
It compares exact city boundaries, saved state aliases and country equivalents, including diacritics,
instead of generic text similarity or a top-result fallback. City questions cannot select broad regions;
generic region questions retain exact saved state/country/region matching. Multiple compatible labels
remain ambiguous. Validated pickers can search async widget catalogs, and committed locations are read
back before reporting green. Lever typeahead text without a committed suggestion stays unresolved.

Location queries are separate from generic dropdown search shortening: full city/state/country,
city/state, then city only. Agreeing state/country qualifiers already present in the saved City are
removed for matching/query construction without modifying storage; conflicting qualifiers require
manual review. Async location search waits for a geographically valid result instead of advancing
as soon as stale/unrelated rows appear. Manual fills reject old content-script build IDs, matching
the queue retry behavior, so a reloaded sidebar cannot silently invoke older page code.

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
existing row. Existing nonempty sheets without a Job Posting URL column are rejected with guidance
to add that column so a lost write acknowledgement can be retried safely. No write occurs on autofill
or connection testing.

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

The sidebar replaces single-link entry with a parsed list and configurable capacity of 1–5
(default 3, maximum 100 jobs per queue). Submitted jobs are excluded; unfinished/abandoned tracked
jobs require explicit resume/retry selection. Resuming creates an owned tab rather than adopting an
arbitrary tracker tab; existing local history is reused. Unsaved website answers stay in the old tab.
Queue metadata lives in applicationQueue; one immutable document snapshot lives in queueContexts.
IndexedDB version 5 adds both tables. lib/application-queue.ts validates records and makes
pure batch decisions. lib/queue-worker.ts atomically claims independent opening/filling attempts within the current batch (maximum five),
then performs browser side effects. Opening pages register their attempt before navigation,
so a stopped service worker cannot silently reopen the same application. Parent/page handshake
races share the same transaction; only one binds the tab.

All current-batch tabs start filling independently in the background; one slow page or AI response does not hold other tabs. Known Profile and Memories fields fill before optional AI question matching and essays. Network messages are bounded and cancelled local waits ignore late results; optional Gemini requests have 45-second abort deadlines. Explicit restart invalidates the old attempt, waits for its writer to stop, and keeps manually entered values.

Both initial queue fills and manual fills use a bounded field-readiness check and one local recovery pass for changed empty controls/new Memory matches. Reporting uses cached job metadata and updates asynchronously; it does not keep capture locked after the writer finishes. Review-only observation watches the document body and retains exact field tokens across unambiguous rerenders.

One preset/document snapshot is stored per queue. Each new fill combines it with the latest
Profile and current opt-in Gemini setting; its immutable fillRuns record binds tab, job, frame
and attempt. Current Memories are matched locally before AI. Pending URLs hold no document
copies and do not open browser tabs. New UI-started queues use a continuous 1–5-tab window: each submitted/skipped owned tab must close before its slot is reused. Optional batch mode and older queues retain the all-items barrier. Submission is recorded locally before optional
Sheets synchronization, whose failure does not block the queue. No website Submit is clicked.

Pause prevents the next claim; Stop disconnects all active sessions and preserves open pages.
Queue observers update review/capture metadata but do not automatically fill later steps.
An explicit Fill this step retries through the bounded scheduler and preserves non-empty values.
Missing forms, closed tabs and bounded loading/fill timeouts offer Retry, Use this page for this job, or Abandon. Chromium
alarms (additional alarms permission) wake durable timeout/recovery checks without keeping the
worker alive. Worker restarts reconcile state; browser restarts pause and detach previous tab IDs,
since those IDs must not authorize closing tabs in a new session. Session-owned markers restrict
closure to queue-created tabs. Previous restored pages are kept; retries open new owned tabs.

Queue-owned tabs are temporarily protected from automatic Chrome discarding while filling, then restored to normal memory management on review/cancellation. Existing pages report their build during Retry; stale content scripts request a page refresh instead of silently ignoring a new fill.

Increment 4 exposes live capacity and add-links controls. Shared pure intake classification drives
preview and transactional commits. Explicit tracked IDs are revalidated; submitted history wins.
`addQueueLinks` appends to the current token without replacing its preset/context or active attempts.
Concurrent additions deduplicate against the stored queue, and the 100-item cap includes finished jobs.
Opening claims reserve slots before browser I/O; closed blocked jobs retain recovery metadata without
holding capacity. Token-bound controls reject stale panels. Abandon settles the attempt before waiting
for cancellation and closing only its owned tab. Closing failures remain visible and occupy a slot
until resolved. A cancelled tabs.create handoff removes only its exact orphan opening page.

## Sidebar layout and review

The first workflow-restructuring increment fixes Fill above the sortable sections in a sticky header.
Legacy collapse/order preferences cannot hide or move it. Optional keyed sections stay mounted and
retain their visibility, drafts and relative order. Missing-answer review opens when a new fill becomes
reviewable, not on every keystroke. Detail statistics remain expandable rather than filling the header.
`lib/application-workflow.ts` derives a shared view from existing application and queue records for the
current summary and queue cards; an in-flight retry takes precedence over an older ready result.
It does not add persisted state or replace the worker scheduler. Independent standalone fills may run
while another queue tab fills; per-tab run ownership and the queue-owned-tab guard remain enforced.

SidebarSection stores validated open/closed booleans per section in extension local storage. SidebarLayout reorders keyed mounted children using native drag handles, keyboard arrows or move buttons, preserving live forms and drafts. A validated versioned local preference retains order across panels; removed IDs are ignored and newly added sections inserted before their next default neighbor. Applications is last by default; Reset order affects order only.

SidebarPreferences stores versioned, allowlisted category visibility. Hidden sections remain mounted to preserve drafts and selected presets; hiding the queue does not cancel it. Fill is always visible as the recovery action. Setup and Track are hidden by default, but can be enabled in Settings → Sidebar.

The current-application summary sits below the fixed Fill header. ApplicationReview holds the confirmed
capture/Save all flow in a separate section with a bounded question-list scroll area; it reveals unresolved
answers after filling while respecting subsequent manual collapse. QueueCard promotes Review/Submitted,
exposes failure retry, and keeps secondary actions/details under More. Setup configuration stays in Settings
with a minimal unfinished-onboarding prompt in Fill. Queue link drafts use session storage. Public-settings
subscriptions ignore unrelated queue/layout status changes.

## Shared submission confirmation

Workflow increment 5 shares `submission-worker.ts` between standalone and queued fills. Content records only trusted user submit/click intent, never fires a Submit action. Supported Greenhouse, Lever and Ashby headings/statuses require the application form to be gone, no visible validation errors, the same origin/company/job route, a recent persisted intent, the live attempt/frame and a browser-session marker. The worker re-probes evidence in that frame and rechecks the actual tab. Queue detection additionally requires its opt-in and queue ownership. Native or visible form errors clear intent and show an attention message. Unfamiliar confirmations remain manual.

`submission-state.ts` builds the same idempotent local update for user and detected confirmation, preserving the first submission date/source. Queue outcomes commit with queue state before owned-tab closure/replacement. Standalone tabs stay open and offer an explicit, session/URL-guarded close action. Manual confirmation remains available on a tracked tab after extraction or confirmation navigation fails. A worker restart preserves intent; browser-session changes invalidate automatic detection/closure.

Sheets starts independently after the local outcome, including when tab closure fails. Pending sync intent persists on the application and is retried on worker startup; failures stay Submitted and offer Retry sheet sync in history. One worker serializes all sheet writes so different applications cannot choose the same empty row concurrently. A Job Posting URL column is required for existing sheets; a retry checks canonical job identity before filling only blank cells. Fetches have a twenty-second bound. Google OAuth, network interruption and external sheet edits remain external failure modes; no live Google account test is implied by synthetic API tests.

Stop autofill & review disconnects/cancels and awaits the old writer before entering a capture-capable read-only session. It does not revoke the existing confirmed Memory flow or run a second fill.

When a foreground owned tab finishes, the worker hands focus to another owned review/opening tab in the same still-focused window. Background completions do not change the active tab.

## Job posting in free-response prompts

Prompts name the posting through `{jobUrl}` (`lib/posting-link.ts`): a same-site link on the form whose text
points back to the job ("View job description", "Job details"), otherwise the posting the form's address
points to (`postingUrl`), otherwise the page itself. Templates without `{jobUrl}` get a `Job posting:` line
appended. When neither the form page nor an adapter's remote source has a description, the content script
fetches that same-site posting with the page's own credentials and reads its JobPosting data or description
block (capped at 8,000 characters). Other sites are never fetched; the address is checked again in the worker.
The default template asks for 3–5 sentences and to stay under the question's character limit; an unedited
copy of the previous default is read as the current one.

## Reloaded application pages

A reload clears what was filled, so after one the side panel shows the page as not filled yet. When a tab with
an unfinished application finishes loading, the worker reads only the page's load timing
(`performance.timeOrigin` and navigation type). A document loaded after the latest fill started and finished,
by a reload or by opening the same address again, sets `pageCleared` on the application inside a transaction
that checks the run and status did not change. Its page status and any chat draft for it are cleared. Moving
to another address (a confirmation page) keeps the results and manual submission controls. The application
stays in history; the next fill resets `pageCleared`.

## Chat-website free responses

The **Free responses** menu above Fill this page (also Settings → Connections) chooses who writes free
responses: None (the person), the Gemini API, or a chat website the person already uses (ChatGPT, Claude,
Gemini web, Perplexity; `lib/chat-providers.ts`). Until the person chooses, it reads as None, or as Gemini
API when a key is already saved, so existing setups keep working. With None, fills write no free responses. With a chat website, fills leave free responses empty and never call Gemini for
them, even when a key is saved; field matching and resume reading still use the key when one exists.
Empty free-response feedback carries `draft: true` whichever source filled the page, so choosing a chat
website after filling still offers drafting. Under the Autofilled / AI-written / Need review counts,
`NeedsAnswerList` lists the Need review questions; clicking one uses `showApplicationField`, and an answered
question leaves the list on the next edit report. Draftable ones have **Draft in …**, and two or more add
**Draft all N in …**: one prompt with the questions numbered in place of `{question}` and a required
`Answer 1`/`Answer 2` reply format (`renderBatchPrompt`). Pasting the whole reply fills one box per
question (`splitBatchReply`); each stays editable, and **Use answers** applies the filled ones, keeping
failed or empty ones in the draft. **Need review** counts required questions that are
unanswered or unverifiable, so it drops when the person answers on the page or uses a draft (AI drafts are
counted under AI-written and stay amber in Review & Remember). Optional unanswered questions are listed and
outlined yellow on the page (`optional` outline state) but not counted.

The person sends every prompt themselves. **Draft in …** asks the content script for the question,
character limit, company, role and posting text (no page answers), renders the person's prompt template
with the run's preset profile in the worker, and stores one active draft in session storage. The panel
copies the prompt while it still has focus, then the worker opens the provider's plain new-chat URL (no
prompt in the URL) beside the application. If the person granted that provider's optional host
permission (asked once from the Settings change or the Draft click), a one-shot `scripting.executeScript`
function waits for the chat's own site (not a sign-in redirect) and puts the prompt in its empty message
box with paste/`insertText` editing commands. It never clicks, submits, reads replies, or replaces typed
text; a missing box keeps waiting for later loads for ten minutes. Without permission the prompt is pasted
by the person. No content script is registered on chat sites.

`ChatDraftCard` sits above the per-tab review, so it stays visible on the chat tab. The person pastes the
reply and clicks **Use answer**: the worker revalidates the application, its tab and run; the session finds the question by its token or,
after a page redraw or refill gave it a new token, by its exact wording, then
writes only that still-empty field (trimmed at a sentence to the field limit), marks it AI/amber for
review, returns focus to the application and shows the field. A typed answer is never replaced.
