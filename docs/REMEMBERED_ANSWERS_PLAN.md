# Remembered answers redesign — proposal

Status: first integrated implementation completed locally. See ARCHITECTURE.md and CONTRACTS.md for the
actual supported behavior. This document also retains later design ideas; they are not all implemented.

Implemented: explicit capture/confirmation, persistent teachable cards, selected-field apply with stale
checks, Saved answers management/search, global/company/application/site scope, conservative migration,
approved local meanings, degree/boolean/category option equivalents, local suggestions with alias approval,
and an optional clicked Gemini wording helper requiring individual approval. Existing page values are kept
even if the panel answer is edited. Employer matching currently uses normalised adapter metadata; users
should choose application scope when unsure. Not yet implemented: replacement of existing values, an
employer identity registry, inferred profile-link previews/categories, multi-select capture, embeddings,
and a broad held-out coverage benchmark. These are incremental follow-up work.

## Implemented clarity follow-up

The 2026-10-06 follow-up replaces **More options** with **Improve future matching**, separating
question variations, fixed-answer dropdown labels, profile linking and original-question editing.
Each variation has a labeled field plus an explicit add/remove action. Scope and recognized meanings
use plain language; profile links display their latest local value. **Try a variation** runs the existing
index and shared writer selection rules locally, with optional dropdown choices and company/application
examples. It distinguishes autofill, explicit confirmation and skipped matches. It does not save or call
AI; changes invalidate the previous result. The optional AI helper remains nested under question wording
and requires individually approved suggestions. Custom dropdown aliases belong to fixed answers, not
changing profile links. Answered cards turn indigo with **Save this answer**; clearing returns them to
white **Remember answer** cards. Text conveys the state without relying on color.

## Goal and confirmed preference

Teach an answer once, reuse it across equivalent questions and dropdown wordings, and make uncertain
cases a quick confirmation. The user prefers answering on the application page, then explicitly
capturing and confirming that answer. AI wording help is available only through an explicit opt-in button;
it does not run automatically or require an API key for local matching.

## Why the current feature feels ineffective

- `selectRememberedMappings` filters records by exact normalized question text before the content
  script sees them. Improving only the content-script matcher cannot recover discarded candidates.
- `resolveRememberedMapping` accepts one exact question or approved alias, rather than a shared meaning.
- `bestRememberedOption` accepts normalized exact answers or unambiguous Yes/No expansions. Equivalent
  categorical answers with different wording often fail independently of question matching.
- The editor asks users to manage question text, answer type, profile keys, aliases, and platform scope.
- Scope validation still only accepts Greenhouse, Lever, and Ashby, despite newer Workday and generic
  adapters. The background also rejects generic-site mapping lookups. This needs fixing in the redesign.
- An ATS platform is not an employer: a SpaceX-specific answer must not apply to every Greenhouse form.

## Main user flow

1. An unresolved field has a clear **Remember answer** button in its side-panel card.
2. The user answers on the page, then clicks that button. Only this explicitly selected field is read.
3. A compact editor shows the original question, the captured answer, and a plain-language description
   of where the answer will be reused. The answer remains editable.
4. **Save & apply** persists the answer, verifies the current field, and updates its card. When the
   captured answer is already committed on the page, it is preserved rather than rewritten. When the
   user edits the answer in the panel, apply only to that selected field after identity/value revalidation.
5. Future equivalent questions fill automatically. Uncertain matches show **Use saved answer**;
   confirming also approves that wording for future reuse.

Example:

```text
Remember this answer
Have you previously worked at SpaceX?

Your answer      No
Use for         SpaceX applications     Change

Save & apply    Cancel
More options
```

Keep manually answered cards available as **Answer entered — remember it?** until dismissed, so the
button does not disappear when verification removes a field from the unresolved list. If nothing is
entered yet, offer **Answer on page** and **Enter answer here**. Dropdown editors show actual available
choices where the widget supports extraction; users should not have to copy option text.

Hide profile linking, alternate wordings, and scope details under **More options**. Offer an inferred
profile link with a readable value preview when appropriate, and require confirmation. Known general
facts can be reused across sites; employer-specific facts are restricted to a verified employer. If
the employer cannot be established, default to the current site and require confirmation to broaden.
Unclassified questions retain approved-wording reuse until their meaning is established.

Rename the management area **Saved answers**. Provide search, compact answer cards, Edit/Delete,
last-used information, and simple categories. No alias editor is required in the default view.

## Store meaning and render the correct answer

Question recognition and dropdown selection are separate decisions:

| Saved meaning | New wording or option | Intended handling |
| --- | --- | --- |
| US citizenship: yes | Are you a U.S. citizen? | Recognized boolean question; choose its Yes variant |
| US citizenship: yes | Citizenship status: U.S. Citizen | Render the saved fact into the status category |
| Citizenship | Options are country names | Country-of-citizenship question; do not use a bare Yes |
| Degree level: bachelor | Bachelor's Degree / Bachelors | Recognized degree-level equivalents |
| Degree: Bachelor of Science | BS / B.S. / BSc | Use existing qualified degree aliases |
| Generic bachelor's degree | Separate BS and BA choices | Ask which qualification applies; do not invent it |
| Prior employment at SpaceX: no | Have you ever worked for us? | Reuse only with verified SpaceX context |

Other hard distinctions: citizenship versus work authorization, clearance held versus clearance
eligibility, current versus future sponsorship, undergraduate versus graduate GPA, and questions about
the applicant versus a referrer. Recognized inverse questions can render the opposite boolean option;
unrecognized negation is a review case. Company-specific essays remain scoped and are not reused merely
because the question resembles another essay prompt.

Use a versioned record with an answer target, optional confirmed intent, relevant qualifiers
(country, employer, timeframe, education entry), scope, observed question and option wording, approved
aliases, and usage metadata. Values can be typed booleans, known category IDs, profile links, or literal
text. Preserve unknown literal answers without forcing them into a category. Migrate existing records
without deleting them; old aliases remain approved, and unknown old meanings remain conservative.

## Local matching pipeline

1. Validate page metadata and normalize presentation, abbreviations, and known synonyms.
2. Classify known question meanings using existing rules plus section, descriptions, and option signals.
3. Filter candidates by intent, scope, entity, subject, timeframe, answer type, and incompatible negation.
4. Try approved exact wording, then confirmed intent equivalence.
5. Use weighted token/phrase similarity to rank remaining candidates for suggestions. A high lexical
   score alone does not authorize automatic reuse of an unknown meaning. Require a clear lead over the
   runner-up, and calibrate thresholds using positive and near-miss fixtures rather than arbitrary scores.
6. Resolve answer equivalence separately, click the matching option through the adapter, then read it back.
7. Report **Filled from saved answer**, **Confirm saved answer**, or an actionable failure such as
   **No equivalent option available**. Distinguish missing knowledge from a widget write failure.

Keep retrieval and private answer values in the trusted background context. Build a local token/intent
index, select candidates for a batch of field descriptors, and send only the selected answer or relevant
review candidates to the appropriate tab. Validate senders, permissions, metadata, and stale field
identities. Do not broaden the current exact filter by shipping the entire knowledge base to the page.

## Optional AI assistance

Use the existing Gemini integration only when the user chooses help while saving or reviewing an answer.
Ask it for a structured proposed intent, qualifiers, and a small set of equivalent wording suggestions;
the user confirms the meaning and suggested aliases before they become automatic rules. Send only the
selected question, minimal context, and option labels; avoid sending the full applicant profile.

Gemini supports [schema-constrained classification](https://ai.google.dev/gemini-api/docs/structured-output).
Schema validation and local meaning checks still apply, and model output remains a suggestion rather
than evidence that an applicant fact is true. A timeout or absent key must not block saving a basic answer.

Do not attempt to generate every possible paraphrase. Optional AI helps teach a meaning; it cannot
guarantee exhaustive coverage. Defer embeddings: [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
can compare semantic similarity, but a new unseen question still needs a query embedding. Using a remote
embedding API in the fill path adds a network dependency; a local model introduces download/runtime
costs. Evaluate those only if the measured local-rule coverage justifies them.

## Performance and rollout

- No required network calls in the remembered-answer autofill path. Index at save time, batch lookups,
  cache results for the fill session, and invalidate caches on edits. Persist records and rebuild after
  service-worker restart; do not rely solely on globals.
- Target: local matching p95 below 50 ms for 100 fields and 500 saved answers on this development machine,
  measured separately from widget/network waiting. A 10-run synthetic unfamiliar-question benchmark
  measured p95 35.6 ms for index construction plus lookup on this development machine. This excludes
  IndexedDB, message transport and widget/network waits; broader hardware and held-out coverage testing remains future work.
- Fill profile and saved answers before AI essays. Existing unrelated AI features are outside this latency
  claim; avoid adding more required AI waits through the remembered-answer redesign.
- First deliver capture/confirmation UI, scope fixes, migration, known-intent reuse, and category rendering.
  Local suggestions and a separate optional clicked AI wording helper are now included in the integrated
  implementation. Broader semantic coverage remains incremental work, with regression fixtures for each addition.
- Update contracts, architecture, roadmap, and the shared instructions in the implementation to describe
  approved meaning-based reuse and explicit capture. Preserve the requirement that unapproved candidate
  aliases are suggestions, and page answers are never silently harvested.

## Acceptance checks

- A selected native or supported custom dropdown answer can be captured, confirmed, saved, and reused on
  another synthetic form with different question and option wording.
- Manually answered cards remain teachable; Save & apply does not refill unrelated fields.
- Approved facts reuse across supported platforms and generic sites with valid permissions.
- Negation, employer, subject, timeframe, GPA level, and citizenship/authorization near misses do not
  silently reuse incompatible answers. Ambiguous dropdowns produce a visible confirmation or fallback.
- Conflicts, stale/rerendered fields, asynchronous dropdown options, existing user edits, migration,
  worker restart, and AI timeout/offline behavior have meaningful unit and real-extension browser coverage.
- Benchmark both correct auto-fill coverage and incorrect matches against a held-out paraphrase set,
  then run repository checks, TypeScript, Vitest, build, and Playwright before publishing changes.
