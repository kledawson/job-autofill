# Shared contracts

These notes describe the current TypeScript contracts and intended follow-up constraints. Types live in `apps/extension/lib/types.ts` and messages in `apps/extension/lib/messages.ts`. Profiles use dependency-free runtime shape validation; broader message validation remains follow-up work. There is no Zod schema.

## Applicant profile

- Current profile uses a single `id: 'me'`, contact/profile fields, nested work authorization, education and experience arrays, skills, preferences, and voluntary EEO fields. Resume and cover letter blobs are stored separately.
- `currentTitle` stores Current position, defaults blank on older profiles, and takes precedence over the current experience entry when filling current-title questions. Local/optional AI resume drafts are validated and merge into empty fields; they do not include eligibility, preferences, or EEO keys.
- Dexie/IndexedDB holds profile, files, saved-answer and field-mapping tables, and the application tracker. Not every table has a user interface yet.

JSON exports use `{ version: 2, profile }`. Version 1 and legacy bare profiles remain readable; missing fields acquire defaults and unknown keys are discarded. Full imports require a string firstName, validate supplied known fields against their primitive/object/array shapes, and validate yes/no and work-mode enums. Date fields remain strings (education/experience YYYY-MM; earliest start YYYY-MM-DD); calendar-format validation remains follow-up work. Invalid imports do not write to storage. Older stored profiles receive new empty eligibility fields when read and are normalized when saved; IndexedDB indexes do not change.

`{ version: 2, kind: 'profile-patch', profile: { ... } }` updates only supplied known fields. Nested objects merge; education/experience items merge by array index, preserving omitted items; skills replace the list. These files are suitable for updating saved answers without erasing contact or school information. They contain personal data and belong in ignored local folders.

Work authorization separately records authorization scope (`any-employer` / `specific-employer` / blank), US citizenship (yes/no/blank), citizenship country, export-control status, one exact clearance/history option, and clearance eligibility (yes/no/blank). An explicit US citizen yes/no takes precedence; when blank, an exact saved US Citizen category in Current status or Export-control status answers citizenship questions. Work authorization, residence, and clearance eligibility do not establish citizenship. Multiple active clearance selections remain manual. Recognized aliases map to canonical profile keys; ambiguous bare Citizenship labels remain unresolved unless visible options establish US-citizen status.

The additive `eeo.autofillSaved` boolean defaults false on new and legacy profiles. When true, saved gender, Hispanic/Latino, race, and veteran choices fill select/combobox/radio/checkbox-group/yes-no controls. Disability and other identity questions remain manual. Empty saved answers do not turn into decline choices; declined answers fill only when explicitly present and the switch is enabled. Saved EEO is excluded from Gemini. Optional unresolved supported fields still receive missing-answer diagnostics.

Profile editors save only fields changed since their loaded snapshot, merging those edits into the latest stored profile inside an IndexedDB transaction. This prevents an older Settings tab from erasing newer imported eligibility answers. User-edited education/experience arrays replace their respective lists, including deletions/reordering. Full profile imports intentionally replace the profile; partial imports merge as described above. JSON files with a leading UTF-8 byte-order mark are accepted.

Unresolved eligibility or self-identification questions expose a side-panel editor with explicit profile fields, the saved-self-identification switch, and partial JSON import. Saving completes before a retry requests a fresh fill context. No identity fact is generated or inferred.

## Field descriptor and fill plan

Field descriptor: ephemeral field ID, input type, label, autocomplete/name/placeholder signals, visible options, and whether a value already exists. Do not retain DOM nodes in persisted records.

The classifier returns profile mappings, free response, consent, challenge, unknown, and manual-only types. Field writers skip non-profile fields except optional Gemini free-response drafting. Self-identification is manual by default; only the four supported saved choice fields become profile mappings when enabled. Identity free responses always remain manual.

Fill result: field ID and outcome (`filled`, `unchanged`, `skipped`, or `failed`) plus a non-sensitive reason. Check field identity and user edits again before writing.

The current fill summary includes `missingLabels` plus `missingFields: { label, reason }[]`. Reasons distinguish missing saved profile values, unselected/rejected dropdown options, manual self-identification, and unsupported questions/uploads. They contain no applicant answers. The `fillFinished` message and stored application accept optional `missingFields` for compatibility with older content scripts and records; old label-only records remain readable. New diagnostics are shape-checked and limited to 500 entries, 90-character labels, and 600-character reasons; extra properties are discarded and the background only stores labels in the reported unresolved list.

## Messages

Define discriminated, versioned messages for scan, plan, apply, verification results, and tracking. Include a request ID and tab/frame context. Validate the sender and payload. Send a selected fill plan rather than the entire profile to content scripts. Define errors and stale-plan rejection explicitly.

## Tracker

Current application: ID, job key, company, title, URL, platform (`greenhouse`, `lever`, `ashby`, or `generic`), status (`Filling`, `Ready for review`, `Submitted`, `Abandoned`), filled/submitted times, AI answer count, and missing-field labels.

Do not change a status to submitted based only on a fill run. The user marks it submitted manually.

Restarting a fill clears the previous counts and unresolved fields. The side panel hides unresolved results while status is `Filling` and labels completed results as the last fill attempt; persisted results are not a live scan of the current page.

The current implementation stores application records locally and can sync selected application metadata to the user's Google Sheet when connected. Review deduplication, API failure, and retry behavior before making the sheet the only history.
