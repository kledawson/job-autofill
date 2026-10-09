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

## Implemented remembered mapping contract

- IndexedDB schema version 2 adds `rememberedMappings`; version 3 adds `lastUsed` and upgrades record
  `schemaVersion` to 2 without adding inferred meanings. Existing answers, aliases, scopes and other tables remain intact.
  The original `savedAnswers` and `fieldMappings` tables were unused placeholders and remain intact.
- New mappings have `schemaVersion: 3`, numeric `id`, `updatedAt`, optional `lastUsed`, full `question`, up to 20 `aliases`,
  `scope` (`all`, `company:<normalised company>`, `application:<URL without fragment>`, `site:<origin>`, or a preserved
  legacy platform scope), and a discriminated `target`: `{kind: 'answer', value}`
  or `{kind: 'profile', key}` or `{kind: 'answers', selections: {value, aliases}[]}`. Fixed lists have
  1–20 unique selections, at most 20 aliases each, labels of 1–1000 characters, and a 20,000-character
  aggregate limit. Duplicate/overlapping labels and mixed known exclusive choices are rejected.
  Lists require record version 3; legacy scalar versions 1 and 2 remain readable without splitting strings.
  Profile keys are allowlisted existing engine keys; computed consent and
  file-upload keys are excluded. Questions are limited to 700 characters and answers to 10,000.
  Optional approved `meaning: {intent, qualifier, negative}` uses a closed local vocabulary; inferred meaning
  must match the original question's parser result. Optional `answerAliases` contains up to 20 authored option equivalents.
  Version 1 records remain readable; invalid/unsupported versions are ignored.
- Runtime validators reject invalid writes and ignore invalid persisted records or unsupported versions.
  Exact normalization preserves negation and every word. Approved meanings allow tested paraphrases, with
  country, authorization scope, sponsorship timeframe and education-level qualifiers. Only recognised
  boolean inverses can flip an answer. Application scope wins over company, site, legacy platform, then global.
  Ambiguous same-scope matches are skipped. Save checks alias/meaning conflicts in a
  transaction; saving the same primary question/scope updates the existing record.
- `matchSavedAnswers({fields})` accepts at most 200 `{label, kind, options, selectionMode?}` descriptors.
  Selection mode is `single`, `multiple` or `unknown`. A saved list cannot fall through an incompatible
  narrow scope to a broader scalar record. Unknown combobox mode can be probed, but writing requires
  positive multiple-choice evidence. An authorised
  content sender receives one exact/meaning match or suggestion ID per field. Unknown similarity never
  approves reuse. The local index is rebuilt per batch from persisted data; worker restarts do not lose it.
  Company context comes from the matching tracked tab/frame/URL, not a caller-supplied company.
  Legacy `getRememberedMappings({questions})` remains exact-only for compatibility.
  `saveRememberedMapping({mapping, id?})` and `removeRememberedMapping({id})` require a same-extension
  extension-page sender and return `Result`. New payloads and IDs are validated before persistence.
- `fillFinished` may include `missingQuestions: (string|null)[]`, aligned with `missingLabels`, which is
  retained on the application record. Null marks a manual-only control. Old tracker records remain valid
  without this property. Optional `reviewFields: {token, label, answered, suggestionId?, selectionMode?, selectedCount?, reason?}[]` keeps manually
  entered unresolved fields teachable. Metadata contains no answers. Optional `usedMappingIds` updates last-used
  times after verified writes. Sender tab/frame ownership and metadata are checked before tracker updates.
- Optional `fillFinished.memoryQuestions: string[]` records at most 200 current eligible question labels,
  each 1–700 characters, including completed questions. It contains no applicant answers. Validation uses
  `parseQuestionList` before any metadata/usage writes; each new fill clears stale labels. Old applications
  without it fall back to review/missing questions. It remains compatible with earlier scoped sidebar memory browsing;
  fuzzy search does not change approved matching. The existing mapping mutation messages support inline
  editing/deletion in Settings. Store/table/message identifiers remain compatible with older data.
- `capturePageAnswer({applicationId, token, suggestionId?})` requires a trusted extension page and checks
  the current tab URL. It routes to the specific frame, returning a selected-field capture with current
  question, value, kind, options, token and single-use `captureId`. No other answers are read.
  `applySavedAnswer({applicationId, token, captureId, mappingId})` checks scope, live element identity,
  question, and unchanged captured value. It preserves non-empty values and writes only an empty selected
  field; a stale capture reports that save succeeded but application needs a fresh capture.
  Captures include `selectionMode`; multiple captures add `values: string[]`. Native multiple-selects,
  clearly labeled checkbox groups and supported React-select chips are captured as fixed lists, including
  a one-item list. Search queries/remove buttons are not answers. Live validation compares the complete
  normalized set, mode, question, element and checkbox member identities.
- `capturePageAnswers({applicationId, tokens})` accepts 1–100 distinct review tokens from a trusted
  extension page. It routes one explicit batch to the tracked frame, returning validated captures and
  skipped-field reasons. It never reads unrelated fields. Captures remain ephemeral in the live session.
  `savePageAnswers({applicationId, entries: {token, captureId, mapping?, profile?}[]})` checks every included snapshot
  before one atomic database transaction spanning profile and memories. A stale capture, conflicting answer or invalid draft rejects
  the whole batch. Equivalent same-question/scope targets reuse existing IDs and preserve aliases; new
  conflicts never silently replace a record. It returns unique saved-record count and an actionable note.
  Successful persistence survives a subsequent page change; failure to clear review cards then requests
  a fresh fill. Batch saving preserves all page values and never invokes AI.
- Fixed selection lists use a pure one-to-one option resolver with per-selection approved aliases.
  Every choice must exist and be enabled before writing begins. Native multiple selects, labeled checkbox
  groups and proved React-select widgets are supported. Existing groups are preserved. A partial runtime
  write stays incomplete, suppresses last-used success and does not blindly roll back page values.
  React-select option discovery/write is bounded to eight seconds and scoped to its owned menu/container.
  Unsupported/custom prompt widgets and profile-linked arrays remain deferred.
- Recognised dropdown equivalents include bachelor's degree variants without confusing BS/BA, unambiguous
  Yes/No expansions and inverses, positively saved US-citizen category/boolean renderings, and small tested
  category dictionaries. A false citizen answer never infers another visa/status. Authored answer aliases
  match exactly for fixed answers. Profile-linked records ignore authored `answerAliases`, including
  legacy ones, so profile edits cannot reuse an old fixed-answer label. The editor saves profile links
  with no custom answer labels; local equivalents continue to follow the current profile value.
  Unknown or ambiguous options remain manual. Profile links use the latest saved facts.
  Literal answers exceeding the field's character limit are skipped rather than truncated.
  Repeatable entries beyond the first use existing per-entry profile matching; generic literal memories
  do not apply to those entries because their identical labels cannot identify the intended fact.
- Mappings contain private applicant answers. They stay local, are excluded from diagnostic logs and
  tracker/Sheets exports, and are included in Delete all local data. Profile JSON exports do not include
  them. Existing profile messages still use the earlier full-profile contract; that separate privacy
  refactor remains future work.
- `suggestAnswerWordings({question})` is an explicit opt-in request from an extension page. Only the
  selected question goes to Gemini; no answer/profile is sent. Runtime validation limits results to five
  proposals and rejects recognisable contradictory meanings. Each proposal is individually selected by
  the user before save. Failure/no key/offline use leaves local authoring and matching usable.
  Optional wording requests have a 15-second deadline; cancellation interrupts their fetch/retry delay
  so they cannot occupy the shared Gemini queue indefinitely.

- The editor's local matching preview validates an unsaved draft with the production validators, checks
  save conflicts and scope, uses `SavedAnswerIndex` plus the writer's shared `rememberedChoice`, and reads
  only the local saved profile/records in a trusted extension page. Multiple-choice examples use the same
  pure selection resolver and return the complete proposed list. It returns a fill/confirm/skip outcome,
  explanatory reason and, for this draft only, a proposed answer. Another record's private answer is not
  exposed in the result. It neither mutates storage nor adds messages, network calls or permissions.
  Example dropdown choices are not saved as aliases. Real widget handling, required-field formatting,
  existing-value preservation and write verification remain outside this illustrative matching preview.

## Confirmed profile learning and sheet tabs

- Captures may include a validated numbered section. Background enrichment adds an optional profile
  proposal: allowlisted key, destination label, normalized new value, previous value, education
  index/entry signature. Page scripts never receive profile proposals.
- Each confirmed save entry supplies exactly one Memory draft or profile confirmation (value, expected
  proposal and explicit replacement flag). Background obtains fresh live snapshots, re-derives all
  proposals against the transaction’s original profile, then commits changes together. Changed facts,
  reordered entries, invalid/duplicate destinations or Memory conflicts reject the entire save.
  Return count remains the Memory count; profileCount reports distinct updated profile fields.
- Learning supports exact contact/link labels, unambiguous education facts (exact GPA on a 4.0 scale),
  explicit US authorization/sponsorship, supported citizenship categories and single supported active
  clearance selections. Contextual questions, ambiguous entries, ranges/unknown scales and unsupported
  facts remain Memories. Existing Memories are never silently migrated into the profile.
- Settings add optional sheetTabId (number or null) and sheetTabName with backward-compatible defaults.
  Numeric IDs survive renaming; missing explicit IDs fail. No-ID connections retain first-tab behavior.
  connectSheets, disconnectSheets and testSheets require trusted extension senders. testSheets returns
  the resolved tab and recognized columns after read-only OAuth requests.


A confirmed profile update can relink the matching fixed-answer Memory to the profile. The confirmation
shows this change; its ID, approved wording, scope and usage history stay intact. Concurrent edits reject
the save. Unrelated Memories are not migrated. GPA options use exact numeric scores or a single
compatible range; overlapping ranges and different scores remain manual.

## Memories backup contract

- Envelope: { format: "job-autofill-memories", version: 1, createdAt, memories }; createdAt is a
  nonnegative representable epoch timestamp. Maximum 5 MB UTF-8 and 1,000 input records.
- Each Memory retains its supported record version (1–3), timestamps, question, approved aliases,
  meaning, scope and target. IDs are excluded on export and regenerated on import. Unexpected
  properties are discarded; invalid known fields reject the entire file. No meanings are inferred.
- exportMemoryBackup, previewMemoryRestore and restoreMemoryBackup are called directly from the
  trusted Settings page, accessing only extension-origin IndexedDB. No page-content bridge or new
  worker-message handler is exposed. Export refuses unreadable stored records; restore validates all fields.
- Preview identifies new items, complete approved-rule duplicates, and same-scope overlapping rules.
  Identical input rules are deduplicated. Different overlapping rules within the file are rejected.
  Current records linked by several incoming rules form one conflict choice.
- Confirmation includes the preview token and exactly one keep or backup choice per nonduplicate
  group. New items default to backup; conflicts default to keep. An override replaces the complete
  rule/group, including aliases and targets. No unrelated records or Profile values change.
- The token hashes file contents plus an ID-sorted current-record snapshot excluding lastUsed.
  Edits/additions/deletions require a fresh preview. Revalidation inside the write transaction closes
  concurrent-edit races. All selected writes/deletions succeed together or roll back.
- New rules preserve original update/usage dates; replacements get the current update time and retain
  the latest usage date. Result counts report added/replaced/removed/duplicate/kept/skipped records.
- Profile-linked targets resolve from the current destination Profile; backups contain no Profile
  snapshot, documents, credentials, Sheets settings or application tracker records.

Restore UI separates stored data from pending choices. Different versions show current and incoming
answers plus matching-rule differences; new items can be excluded individually or together. The
summary counts actual records added and removed, including grouped overlaps. Identical stored rules
and repeated entries inside a file are described separately. Layout changes do not alter matching,
transaction atomicity, conservative defaults, import formats or Profile references.

## Application preset contract

- ApplicationPreset has schemaVersion 1, immutable ID, positive revision, timestamp, name,
  resume/coverLetter document choices, portfolio/GitHub/website overrides, AI emphasis and prepared
  responses. A document choice is profile, none or an immutable PDF ID. Null links inherit the
  Profile; blank overrides skip a link. Only http(s) URLs without credentials are accepted.
- Limits: 30 presets, 80-character names, 4,000-character emphasis, 20 responses, 700-character
  questions, 10,000-character answers, 10 approved wordings per response and 10 MB per PDF.
  Repeated/overlapping approved response wordings are rejected. Names are unique ignoring case.
- Save compares the expected revision inside a write transaction spanning presets and presetFiles.
  PDFs staged in the UI are persisted only with a successful save. Duplication references immutable
  documents; deleting/updating one preset never deletes a file another preset uses. Default remains
  available. Selection is stored separately and falls back to Default after selected-preset deletion.
- Shared Profile facts and personal Memories are not duplicated or rewritten. Preset resolution
  overrides only approved presentation links. Prepared responses apply to text/textarea questions
  classified as unknown/free-response, before optional AI. Known Profile fields remain canonical.
  Alternate wordings are explicit user approvals; similarity alone never authorizes reuse.
- FillContext adds optional preset metadata and a runId. startFill/fillActiveTab accept a validated
  optional presetId from a trusted extension page. The background snapshots resolved Profile,
  document payloads and preset responses before fill. A run belongs to one tab and stable job
  identity, across permitted frames. generateAnswer/fillStarted/fillFinished bind to this run.
  Caller-controlled run IDs cannot access another tab's context; replaced runs reject late results.
- Runtime worker restarts preserve the run context in trusted extension-origin IndexedDB. Closed
  tabs and explicit new fills remove old runs. Snapshots contain private applicant data, are excluded
  from logs/exports and are cleared by Delete all data. No credentials are included in a snapshot.
- Application records add optional preset ID/name/revision, selected resume filename and runId.
  Historical records stay readable. Existing fields/uploads remain protected; using a different
  preset on a live already-filled form requests a fresh form instead of silently mixing presets.
- Profile JSON and Memories backup formats stay unchanged and exclude presets and their PDFs.

## Application queue contract

- applicationQueue is an additive IndexedDB v5 table with one current schemaVersion-1 record:
  queue token, status, batch size, current batch, timestamp, preset display metadata and validated
  items. A separate queueContexts table stores one pinned preset/document snapshot, so progress
  transactions do not rewrite PDFs. The snapshot excludes the Profile and credentials. Each item holds its own
  immutable ID, canonical URL/key, batch, state, attempt UUID, optional owned tab/frame/application
  IDs, deadline and actionable note. Maximum 100 items, batch size 1–5. Generic job-ID query
  parameters survive normalization; tracking parameters are removed. LinkedIn is excluded.
- Queue creation, claims and item decisions use IndexedDB write transactions. Only one item may
  be opening/filling. All current review items must settle and close before another batch starts.
  Batch size edits affect future assignments. A new queue requires the old one complete/stopped.
- startQueue, getQueue, controlQueue and queueAction require trusted extension pages. Actions and
  IDs are validated. getQueue excludes document payloads. Queue/token/item IDs prevent stale-panel
  actions from changing another queue. queueOpening additionally requires its exact extension-owned
  opening URL and sender tab. queueFinished requires a permitted content sender; application results
  must match run, tab and frame. Duplicate/late completions cannot advance a replaced attempt.
- claimPendingFill carries optional queued/runId metadata and atomically claims one frame. Queue
  content fills are bounded; missing forms require action. fillStarted and generateAnswer require an
  active writing attempt; later review metadata may use the owned run without starting a new fill.
  Explicit retries bind a new context and preserve user-entered values.
- Submitted and Skip close only queue-created/session-owned tabs. Submitted requires a ready item
  and explicit user confirmation; the tracker update is atomic with the queue decision. Skip does
  not mark submitted or write Sheets. Sheets sync starts independently after local persistence.
  A double click retries closure without creating another submission. Stop preserves opened tabs.
- A worker restart retains attempts and contexts. A new browser session pauses the queue, invalidates
  its old run contexts and detaches persisted tab IDs; restored website pages are kept. Queue records,
  private document snapshots and run contexts are excluded from exports and cleared by Delete all data.
