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
  without it fall back to review/missing questions. It supports read-only scoped sidebar memory browsing;
  fuzzy search does not change approved matching. The existing mapping mutation messages support inline
  editing/deletion from both trusted UIs. Store/table/message identifiers remain compatible with older data.
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
  `savePageAnswers({applicationId, entries: {token, captureId, mapping}[]})` checks every included snapshot
  before one atomic database transaction. A stale capture, conflicting answer or invalid draft rejects
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
