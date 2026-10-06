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
- Each mapping has `schemaVersion: 2`, numeric `id`, `updatedAt`, optional `lastUsed`, full `question`, up to 20 `aliases`,
  `scope` (`all`, `company:<normalised company>`, `application:<URL without fragment>`, `site:<origin>`, or a preserved
  legacy platform scope), and a discriminated `target`: `{kind: 'answer', value}`
  or `{kind: 'profile', key}`. Profile keys are allowlisted existing engine keys; computed consent and
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
- `matchSavedAnswers({fields})` accepts at most 200 `{label, kind, options}` descriptors. An authorised
  content sender receives one exact/meaning match or suggestion ID per field. Unknown similarity never
  approves reuse. The local index is rebuilt per batch from persisted data; worker restarts do not lose it.
  Company context comes from the matching tracked tab/frame/URL, not a caller-supplied company.
  Legacy `getRememberedMappings({questions})` remains exact-only for compatibility.
  `saveRememberedMapping({mapping, id?})` and `removeRememberedMapping({id})` require a same-extension
  extension-page sender and return `Result`. New payloads and IDs are validated before persistence.
- `fillFinished` may include `missingQuestions: (string|null)[]`, aligned with `missingLabels`, which is
  retained on the application record. Null marks a manual-only control. Old tracker records remain valid
  without this property. Optional `reviewFields: {token, label, answered, suggestionId?}[]` keeps manually
  entered unresolved fields teachable. Metadata contains no answers. Optional `usedMappingIds` updates last-used
  times after verified writes. Sender tab/frame ownership and metadata are checked before tracker updates.
- `capturePageAnswer({applicationId, token, suggestionId?})` requires a trusted extension page and checks
  the current tab URL. It routes to the specific frame, returning a selected-field capture with current
  question, value, kind, options, token and single-use `captureId`. No other answers are read.
  `applySavedAnswer({applicationId, token, captureId, mappingId})` checks scope, live element identity,
  question, and unchanged captured value. It preserves non-empty values and writes only an empty selected
  field; a stale capture reports that save succeeded but application needs a fresh capture.
  React-select single-value labels and one selected multi-value chip can be captured. Chip labels are
  read without remove buttons/icons or double-counting nested label elements. A search query alone is
  not a selected answer. Several selected chips are rejected explicitly; native multiple-selects and
  checkbox groups remain outside the single-answer capture contract.
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
  only the local saved profile/records in a trusted extension page. It returns a fill/confirm/skip outcome,
  explanatory reason and, for this draft only, a proposed answer. Another record's private answer is not
  exposed in the result. It neither mutates storage nor adds messages, network calls or permissions.
  Example dropdown choices are not saved as aliases. Real widget handling, required-field formatting,
  existing-value preservation and write verification remain outside this illustrative matching preview.
