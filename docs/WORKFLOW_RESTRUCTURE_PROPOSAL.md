# Proposal: a cohesive application workflow

**Status:** Approved by the owner for incremental implementation on `codex/application-queue` on October 17, 2026. Review each checkpoint before proceeding to the next. This document includes work that is still planned.

**Updated:** October 20, 2026. The earlier publication snapshot below is dated October 19.

**Purpose:** Align contributors on how Job Autofill should behave when filling one application or preparing a queue of applications. This document describes intended behavior and acceptance criteria; it is not a claim that these features have shipped.

## Implementation checkpoints

Deliver these increments on the feature branch, with actual validation results and user testing instructions for each. Keep `main` unchanged until a separate merge request.

| Increment | Scope | User checkpoint |
| --- | --- | --- |
| 1. Shared workflow presentation and permanent Fill | Reuse persisted application/queue state for consistent actions, pin Fill above optional sections, compact the summary, reveal missing answers, allow independent manual filling during queue work. | Fill remains available after scrolling/reopening; manually fill another job while the queue is busy; existing Memories still capture. |
| 2. Login and resume | Explicit login/loading/blocked states, safe navigation and resume, bounded waiting. | Sign in on the website and resume without losing the job or affecting other applications. |
| 3. Review and learning | Clear field priorities, Show field, simple confirmed Profile/Memory destinations. | Complete gaps, save one or all answers, then verify appropriate future reuse. |
| 4. Live queue controls | Visible capacity changes, adding links, status-aware duplicates, pause/retry/abandon. | Increase three to five, decrease safely, add jobs, and recover a blocked job. |
| 5. Submission and tracking | Shared supported confirmation, manual fallback, owned-tab handoff, independent Sheets retry. | Successful submission advances once; validation errors never close or advance. |
| 6. Recovery and release | Restart/cancellation races, accessibility, measured overhead, benchmark and packaging. | Resume after interruption and reproduce the documented supported workflow. |

Increment 1 begins with a shared **derived view** of existing persisted state. It does not yet replace the background transition controller, add login detection, or expand automatic submission support. Those changes belong to later increments.

**Current checkpoint:** All six increments are implemented for review on `codex/application-queue`.
Checkpoint 6 adds failed-closure capacity recovery, observer/timer cleanup, visible build information,
keyboard/narrow-sidebar checks, a controlled benchmark and checked 0.2.0 review packaging. Reload the
rebuilt extension and refresh existing application tabs after copying unsaved answers. This is not a
release on `main` or a Chrome Web Store publication. The broader product vision still includes goals
requiring real-site/human measurements and further platform work.

### Checkpoint 6 — October 20, 2026

The queue retains a completed tab's slot through closure failures; worker recovery closes it once and
only then opens the replacement. Repeated review setup replaces old observers/listeners. Disconnect
stops pending edit callbacks and late parser clearing; empty overlays release periodic work. Version
0.2.0 and its build timestamp are available in the keyboard-accessible footer, with update instructions.

The [review guide](RELEASE_REVIEW.md) documents the supported workflow matrix, privacy, recovery and
versioned ZIP/checksum/provenance checks. CI runs these checks and retains the review package and
aggregate benchmark report. One development-only ZIP reader verifies archive members without adding
an extension runtime dependency. No new permissions, backend or automatic submissions are added.

The [first controlled benchmark](BENCHMARK_RESULTS.md), recorded October 20 at 15:58 PDT, filled 90/90
eligible answers across nine fictional applications, with zero incorrect nonempty fills and no submits.
It measures local review latency and page JS heap relative to the same forms without the extension.
It does not measure total Chrome RAM, human review time or real-employer throughput.

Validation completed October 20, 2026 (PDT), using Windows, Node.js 22.23.3 and Chromium
153.0.8010.12:

| Check | Actual result |
| --- | --- |
| Repository checks and TypeScript | Passed |
| `npm test` | 484 passed across 32 files |
| `npm run test:e2e` | Build passed; 50 browser cases passed, 2 failed, 9 did not run, 1 configuration-specific skip in an interrupted 58.4-minute run |
| Fresh `login-resume.spec.ts` and `queue-review.spec.ts` run | All 16 passed in 2.1 minutes, including both failed cases and all cases skipped by their serial groups |
| New closure/keyboard focused checks | Both passed in 13.0 seconds; included again in the broad run |
| `npm run benchmark` | Passed: 90/90 correct eligible answers, zero incorrect nonempty answers, no submits across nine fictional forms |
| `npm run release:package` | Passed: 0.2.0 ZIP, 30 byte-matching files, checksum and release provenance |
| `npm run test:release` | Private-file, fake credential-pattern, version mismatch and outdated ZIP rejected; restored package reverified |
| Packaged build footer check | Passed in 4.2 seconds; synthetic screenshot in ignored `local-data/workflow-increment-6/` |

The broad run experienced an approximately 49-minute execution pause during its authentication check;
the check then observed login instead of account creation. A later browser renderer reported Target
crashed in the review group. Both complete groups passed in fresh browsers without application-code
changes. Across the broad and fresh runs, all **61 applicable browser cases** were exercised successfully;
a single fresh all-green full run is not claimed. The remaining configuration skip checks a build
without OAuth, while this local build already configures it. No real employer submissions or personal
Google-account OAuth were tested. CI is configured for these checks but has not run for these local edits.

Packaging initially exposed an unavailable ZIP-reader assumption. The final checker uses the pinned
development-only `yauzl` dependency and streams archive members without filesystem extraction.
The extension bundle and permissions do not include this build tool. Generated artifacts and raw
measurements remain ignored; this checkpoint is implemented locally and has not been pushed or merged.

### Dated implementation record

Dates below are the documented checkpoint dates in America/Los_Angeles. Exact coding times were
not recorded; the publication-review timestamp above is separate from those implementation dates.

| Date | Completed checkpoint | Main affected areas |
| --- | --- | --- |
| 2026-10-17 | 1. Permanent Fill, shared status/actions, compact summary and location corrections | Sidebar, workflow view, geographic option matching and read-back verification |
| 2026-10-17 | 2. Login and safe resume | Form readiness, content-script watchers, bounded queue waiting and attempt ownership |
| 2026-10-17 | 3. Review and learning | Field feedback, Show field, user-edit preservation and Profile/Memory confirmation |
| 2026-10-18 | 4. Live queue controls | Capacity, add-links intake, explicit resume/retry, abandonment and stale-control guards |
| 2026-10-19 | 5. Submission and tracking | Supported confirmation, manual fallback, owned-tab handoff and independent Sheets recovery |
| 2026-10-20 | 6. Recovery and review packaging | Failed-close recovery, observer cleanup, accessible build information, controlled measurements and checked 0.2.0 package |

The six-checkpoint redesign sequence is complete for review. Passing the controlled checks below does
not establish that every employer form is supported or that performance targets have been measured.

Publication preparation on 2026-10-19 (PDT, UTC−07:00):

- **13:23:40** — `b6278b5` records the implemented checkpoints and dated documentation.
- **13:24:57** — `2b15bce` integrates `main` through `c09639e` into this feature branch. The merge
  retains compact company/date history and confirmed Clear all alongside the redesigned sidebar and
  Sheets retry controls. A browser regression checks cancellation, records beyond the visible 50-row
  list, and preservation of Profile/Memories. No changes are merged back into `main` by this publication.

### Publication validation — 2026-10-19, 13:36 PDT (UTC−07:00)

Validation used Windows, Node.js 24.12.0, npm 11.6.2 and the production Chromium extension build.

| Check | Actual result |
| --- | --- |
| `npm run check` | Passed, including local documentation links |
| `npm run typecheck` | Passed on the merged source |
| `npm test` | 481 passed across 31 files on the merged source |
| `npm run build` (through `test:e2e`) | Passed; current and legacy unpacked-extension folders updated |
| `npm run test:e2e` | 58 passed, 1 configuration-specific skip, 1 new test-fixture failure in 10.8 minutes |
| `npx playwright test tests/e2e/extension.spec.ts --grep 'merged history controls'` | 1 passed after correcting the fixture, in 7.6 seconds |

The new history test originally seeded IndexedDB without refreshing the UI's Dexie subscription.
Its focused retry also exposed an assumed pre-existing Profile in a fresh browser. The fixture now
persists a Profile and Memory explicitly and reloads after raw database seeding. Its final run checks
Clear all cancellation, deletion beyond the visible 50 records, retained Profile/Memories and permanent
Fill availability. No application source changed after the full-suite build. All **59 applicable
browser cases** passed across the full and corrected focused runs; a single fresh all-green full run
is not claimed. The skipped test specifically requires a build without an OAuth client, whereas this
local build has one configured. Personal-account OAuth and live employer submissions were not tested.

Individual and queued fills now share supported Greenhouse, Lever and Ashby confirmation checks.
Submit on the website yourself: a click alone never counts. Validation failures show **Submission
needs attention** and keep the tab open. Individual success stays open with **Close application tab**;
queue success records once and closes only its owned tab when automatic confirmation is enabled.
Background completion preserves focus; foreground completion hands off to another prepared job.
Unfamiliar result/navigation keeps **I submitted this application** (or **Submitted — close tab**)
available for explicit confirmation. Save Memories before submitting.

Sheets writes follow the local outcome independently, are serialized across applications, and recover
pending intent after a worker interruption. A failed write stays Submitted with **Retry sheet sync**
in Applications history. Existing sheets require a Job Posting URL column to recognize retry identity.
A lost successful-write response is checked against that URL before another row is added. Sheets is
optional: no connection does not show a submission warning. A paused queue becomes Complete when its
last confirmed/abandoned tab closes and nothing is waiting.

Validation for increment 5 (October 19): repository checks, type checking, production build and all
481 unit tests passed. The final fresh Chromium suite completed successfully: **58 passed, 1 skipped**
in 11.1 minutes. The skip is the missing-OAuth setup case, which does not apply to this OAuth-configured
build. An earlier run exposed an incorrectly renamed Track without autofill test selector; the selector
was restored before the clean full rerun. The final build covers the earlier checkpoints as well.

Five new browser cases cover standalone supported confirmations and source metadata, validation and
unfamiliar-result fallback, the active job remaining accessible beyond 50 history entries, forged/stale
confirmation rejection, mixed-platform queue handoff without background focus stealing, confirmation
while paused, lost Sheets responses, independent retries, concurrent row selection and duplicate clicks.
New unit cases cover evidence/route/intent bounds, idempotent dates/sources, paused completion, lost-write
retry and rejecting sheets without a URL identity column. Synthetic screenshots are in
`local-data/workflow-increment-5/`, outside version control. Controlled fictional forms and simulated
Google responses exercise these paths; live employer submissions and personal Google-account OAuth are
outside this automated validation.

During an active continuous queue, **Open application limit** is always visible. Increase three to
five to open up to two more waiting jobs immediately. Reducing the limit keeps existing tabs and shows
why replacements wait. Sign-in, blocked and closing tabs occupy slots; closed blocked jobs keep a
Retry action without consuming capacity. **Add job links** appends jobs to the same pinned preset,
including while paused. The total cap is 100 jobs, including finished entries. **Pause queue** holds
new openings, and **Queue options → Stop queue** keeps opened pages.

The link preview distinguishes new jobs, current queue entries, unfinished history, abandoned history
and submitted history. Resume/retry requires an explicit checkbox and opens a new owned tab using
saved Profile/Memories; it does not transfer unsaved page answers. Submitted history stays excluded.
**More → Abandon — close tab** stops a stalled writer, records Abandoned and closes only its owned
tab before releasing space. A failed closure remains visible for retry. Queue controls bind to the
current token, and concurrent additions deduplicate in the same storage transaction.

Validation for increment 4 (October 18): repository checks, type checking, production build and all
474 unit tests passed. The broad Chromium run had 52 passes, one configuration-specific OAuth skip,
and a failure in the abandonment test's earlier held-network fixture. After correcting that fixture,
all three new queue cases passed against the final build. Thus all 53 applicable browser cases passed
across the regression and focused runs; a single fresh full-suite green run is not claimed here.
New cases cover live 3→5→2 limits, paused additions, worker restart, concurrent duplicate additions,
stale tokens, the 100-job cap, closed-tab capacity, explicit history resume/retry, submitted exclusions,
and abandonment with a delayed AI response and an unrelated tab. Synthetic screenshots live under
`local-data/workflow-increment-4/`, outside version control. Employer-specific pages and live Google
account/Sheet writes were not exercised by these controlled browser fixtures.

After filling, open **Review & remember**. Required gaps and failed writes come first, then amber
review items and optional gaps. Green **Verified** indicates a saved answer was applied and read back;
neutral **Entered by you** preserves page answers and manual edits. Expand **Verified & entered
answers** to inspect completed controls. These labels reflect evidence, not probability scores.

Use **Show field** to scroll once to the live question. Answer on the website, then **Save this answer**
or **Save all answered questions**. The confirmation moves into view and names **Profile** or **Memory**
as its destination. Profile replacement still needs explicit confirmation, and contextual Memories
retain their reuse scope. Changes to verified answers lose their green status; partial writer failures
remain incomplete. Tests also cover wrapping labels that previously included dropdown options, textarea
answers or unrelated preceding headings. Autofill focus avoids scrolling the job page.

Validation for increment 3 (October 17): all 469 unit tests, repository checks, type checking and the
production build passed. The full Chromium suite completed with 50 passed and one configuration-specific
skip: the missing-OAuth setup case does not apply to this OAuth-configured build. Coverage spans the
earlier workflow increments, presets, Memories, backup/restore, simulated Sheets connection, location
matching, queue recovery and submission safeguards. New review cases cover priorities, one-action
field location, stale navigation, manual edits, save destinations, replacement confirmation and AI review.
The final panel refinements were rechecked with both focused review cases after rebuilding.
Synthetic evidence is kept under `local-data/workflow-increment-3/`, outside version control.

Try a queue containing one application requiring sign-in and another with an accessible form. The
first should show **Sign in required → Open to sign in** while the second fills. Complete sign-in
on the website and return to the original job in the same queue tab: its form should fill automatically.
Account creation and verification remain manual too. Stop/Skip cancel waiting. A fixed 30-minute
deadline offers retry instead of leaving the queue stuck. Pause prevents new jobs from opening;
already opened jobs may finish signing in and filling.

For an individual application, click **Fill this page**. If sign-in is needed, complete it yourself,
then click **Fill this page** on the application. Same-document login transitions show **Application
ready**. External login popups and unsupported redirects require returning to the original tab/job;
the extension never signs in, fills credentials, or transfers this attempt to another job.

Validation for increment 2 (October 17): repository checks, type checking, production build, all 461
unit tests, and 22 focused Chromium extension tests passed (15 existing queue/review regressions and
7 login/resume tests). New browser cases cover independent filling while another job waits, dynamic
and full-navigation resume, worker recovery, an unrelated-job redirect, manual standalone login,
Stop/Skip, account creation, verification and persisted wait expiry. Synthetic screenshot:
`local-data/workflow-increment-2/login-required.png` (ignored local evidence). Employer-specific login
pages and external identity-provider integrations are not claimed universally supported.

Validation for increment 1 (October 17): repository checks, type checking, production build,
435 unit tests, and 12 focused Chromium extension tests passed. Browser coverage includes a separate
manual fill during a stalled queue AI request, confirmed Memory reuse, cancellation, restart recovery,
and the pinned Fill action during scrolling, legacy collapse preferences, and section reordering.
Tests use fictional applications and do not establish universal coverage of employer websites.

Checkpoint 1 follow-up: a reported wrong-city selection is addressed with geographic matching and
committed-value verification. Location dropdowns no longer guess the first search result. This is a
correctness fix within checkpoint 1, separate from the subsequent login and sidebar redesigns.

## Contents

- [Product direction](#product-direction)
- [Problems to resolve](#problems-to-resolve)
- [User flow](#user-flow)
- [Sidebar design](#sidebar-design)
- [Application states and recovery](#application-states-and-recovery)
- [Login and navigation](#login-and-navigation)
- [Review priorities and field feedback](#review-priorities-and-field-feedback)
- [Profile, presets, and Memories](#profile-presets-and-memories)
- [Queue behavior](#queue-behavior)
- [Submission confirmation and tracking](#submission-confirmation-and-tracking)
- [Technical design](#technical-design)
- [Performance and privacy](#performance-and-privacy)
- [Implementation sequence](#implementation-sequence)
- [Validation and release criteria](#validation-and-release-criteria)
- [Decisions for review](#decisions-for-review)

## Product direction

Make the extension a cohesive daily tool with one understandable pipeline:

**Open → Fill → Review → Remember reusable answers → Submit on the website → Confirm success → Next application.**

Users enter this pipeline through either **Fill this page** or **Start queue**. Both entry points must use the same filling, matching, verification, and recovery behavior. A queued application should not miss approved Memories that a manual fill would use.

Build on existing profiles, platform adapters, presets, Memories, uploads, optional AI responses, application tracking, and optional Google Sheets integration. Audit the current branch before implementation: some foundation work exists locally and must be verified and preserved. The sections below are proposed outcomes, including improvements to existing behavior.

### Goals

- Make manual work obvious: show what is missing, why it needs attention, and what the user can do next.
- Keep application preparation moving while the user reviews other applications.
- Make interrupted jobs recoverable without duplicate tabs, lost state, or overwritten edits.
- Keep the interface compact without hiding essential actions.
- Establish measurable reliability and performance results suitable for a portfolio and interview discussion.

With a complete Profile and relevant approved Memories, aim to fill at least **90% of eligible reusable fields on a defined supported-form benchmark**. Measure incorrect fills separately: skipping an uncertain field is preferable to inserting an incorrect fact. Employer-specific essays, credentials, CAPTCHA, and unsupported uploads should not inflate the denominator.

The user's aspiration is to complete 15 applications in the time previously needed for three. Treat that as a **fivefold throughput target to measure**, not a promised result. Record both active user time and total elapsed time.

### Boundaries

- The user reviews and submits every application on the website. Detecting a successful submission does not mean submitting automatically.
- The extension never invents applicant facts, signs into accounts, enters verification codes, or solves CAPTCHA.
- Keep data local by default; existing external integrations remain opt-in.
- Keep broad job search, LinkedIn automation, a separate tracking dashboard, and an interactive demo playground outside this restructuring effort.
- Retain the current stack. No backend, database service, or framework replacement is proposed.

## Problems to resolve

| Current inconsistency to audit | Intended behavior |
| --- | --- |
| Fill controls can disappear inside collapsible or reordered sections. | A compact, permanent Fill this page action stays at the top. |
| Duplicate summaries and expanded cards compete for sidebar space. | One current-application summary and one attention workspace. |
| A login page can look like an empty or unsupported application. | Explicit Login required state with a clear way to resume. |
| Submission detection and recovery differ between queued and individual applications. | Shared confirmation logic with a persistent manual fallback. |
| Manual confirmation can disappear while a page is loading or reporting an error. | Actions remain associated with the tracked application through navigation. |
| Batch behavior and open-tab capacity are easy to confuse. | Use the label Applications open at once and continuously replace completed jobs. |
| Queue fills can miss fields that a manual retry fills successfully. | Same readiness checks, approved answer sources, and bounded recovery path. |
| Previously tracked jobs may all be treated as duplicates. | Handle submitted, unfinished, abandoned, and already queued jobs differently. |
| A retry can report zero newly filled fields even when the form is mostly complete. | Separate overall completion from writes made in the latest attempt. |

The existing continuous queue controller already has a capacity-update path. Verify and extend it rather than adding a competing scheduler.

## User flow

```mermaid
flowchart TD
    A["Find a job or paste application links"] --> B{"Individual or queue?"}
    B -->|Individual| C["Click Fill this page"]
    B -->|Queue| D["Choose open-tab limit and start"]
    D --> E["Open queued application and start preparation"]
    C --> F{"What is on the page?"}
    E --> F
    F -->|Login or account creation| G["Show Login required"]
    G --> H["User logs in on the website"]
    H --> I["Form appears: resume queue fill or click Fill this page"]
    F -->|Application form| I
    F -->|Blocked or unsupported| J["Explain the problem with Retry and Abandon actions"]
    J -->|Retry| F
    J -->|Abandon| K["Record abandonment"]
    I --> L["Fill known answers and verify selected values"]
    L --> M["Show missing answers and answers needing review"]
    M --> N["User completes missing fields and optionally saves reusable answers"]
    N --> O["User reviews and submits on the website"]
    O --> P{"Submission result?"}
    P -->|Validation error| M
    P -->|Recognized success| Q["Record Submitted once"]
    P -->|Unrecognized result| R["Keep manual submission confirmation available"]
    R -->|User confirms success| Q
    Q --> S{"Queued application?"}
    K --> S
    S -->|Yes| T["Close the owned tab when appropriate and release its slot"]
    T --> U{"More jobs and queue running?"}
    U -->|Yes| E
    U -->|No| V["Show queue progress or completion"]
    S -->|No| W["Keep the standalone tab open and show the outcome"]
```

For one application, the user opens the page, fills it, completes the highlighted gaps, optionally remembers answers, and submits. If login is required, they log in on the website and then fill the application.

For a queue, the user pastes links and starts preparation. The extension prepares a bounded number of applications while the user reviews one. Confirmed completion or abandonment frees a slot for the next job. A login or blocked application remains visible without stopping preparation in other occupied slots.

## Sidebar design

The core sidebar should answer three questions immediately: **What can I do now? What needs my attention? What is the queue doing?**

Illustrative layout, using fictional information:

```text
Job Autofill                                  Settings

[ Fill this page ]
Software Engineer · Example Company
3 missing · 2 answers to review                 Details ▾

CURRENT APPLICATION
[ Missing answers (3) ] [ Review (2) ]

On-site availability
Answer on the page.                            [ Show field ]

Start date
Answer entered — ready to remember.
[ Remember answer ]

[ Save all answered questions (1) ]
[ I submitted this application ]
Having trouble?                                [ Get help ]

APPLICATION QUEUE
3 open · 8 waiting · 4 submitted
Applications open at once: [ 3 ▾ ]              [ Pause ]

Current application                            Reviewing
Another prepared application                   [ Open ]
An application requiring login                 [ Open ]
More queue controls ▾

Presets ▸
Applications ▸
```

### Layout rules

- Keep Fill this page visible at the top, including during sidebar scrolling. It cannot be collapsed, hidden, or dragged below optional categories.
- Show the role, company, and meaningful attention counts. Put detailed statistics, resume information, and diagnostics behind Details.
- Hide unhelpful zero-value statistics such as 0 AI-written.
- Automatically expose the current attention list when there are gaps. Move resolved items out of the main list.
- Provide one clear workspace for current missing answers, review, and remembering. Avoid another full duplicate application card in the queue.
- Keep the queue compact: state, capacity, progress, and a direct way to open a job.
- Keep presets and history collapsed by default. Respect saved expansion, visibility, and ordering preferences for optional sections below the fixed core.
- Use plain-language feedback after every action. Saving, retrying, and errors appear beside the relevant control.
- Support keyboard navigation and visible focus. Labels and icons must communicate state alongside color.

## Application states and recovery

Use one authoritative application lifecycle. Page readiness, fill progress, and submission outcome should remain separate concepts so an optional task cannot lock the entire interface.

| User-visible state | Explanation and available action |
| --- | --- |
| Ready to start | Fill this page. |
| Loading application | Show bounded progress; offer help or cancellation. |
| Login required | Ask the user to sign in on the website; preserve the application context. |
| Filling | Show the current phase; allow Finish manually. |
| Needs answers | List missing fields with reasons, Show field, and remembering actions. |
| Ready for review | The writer has stopped; the user can review and submit on the website. |
| Checking submission | Look for confirmation while retaining an appropriate manual fallback. |
| Submitted | Show the confirmed outcome and separate integration sync status. |
| Blocked | Explain the actual issue; offer Retry or Abandon. |
| Abandoned | Preserve the outcome in history and release the queue slot when its tab is closed. |

Ready for review must mean the extension is no longer writing into the form. Optional metadata lookup, AI work that has been canceled, and Google Sheets synchronization must not prevent the user from answering or saving Memories.

Finish manually cancels outstanding writes and waits for the writer to stop. Late callbacks from the canceled attempt cannot overwrite subsequent user edits or update a newer attempt.

## Login and navigation

- Detect a combination of signals: visible sign-in controls, password or verification screens, supported platform routes, and whether a real application form is present. Avoid relying only on field count.
- Tell the user Login required rather than showing indefinite Filling or a generic failure.
- Never fill credentials, verification codes, or CAPTCHA fields.
- For an individual application, keep Fill this page available after login.
- For a queued application, preserve the intended job and resume preparation once a supported application form is ready. Offer Resume when readiness is uncertain.
- Treat redirects and login popups as changes requiring ownership checks. Do not adopt or close an unrelated tab. If necessary, ask the user to explicitly associate the destination with the application.
- A login-waiting job occupies an open-tab slot but does not block filling other jobs.
- Use bounded readiness checks and actionable timeouts. A job cannot remain an unexplained spinner forever.

## Review priorities and field feedback

Prioritize required missing fields, then answers needing review, then optional gaps. Every item should explain the problem and the next action.

Examples:

- Start date: No saved Profile answer. Enter it on the page, then save it to your Profile.
- Academic transcript: Upload this document on the application page.
- Citizenship: No verified matching option. Choose the correct option on the page, then confirm whether it can be reused.

Show field should scroll once to the correct control and briefly highlight it. Filling in background tabs must not repeatedly scroll or steal focus. Preserve non-empty page values unless the user explicitly chooses replacement.

| Visual treatment | Meaning |
| --- | --- |
| Green + Verified | A saved fact or approved Memory was applied and verified against the control's selected value. |
| Amber + Review | A generated draft or interpretation needs the user's attention. |
| Red + Missing | A required answer is missing or a write could not be verified. |
| Neutral + Entered by you | An existing user answer was preserved. |

These are evidence-based review priorities, not invented confidence percentages. Green does not guarantee that an applicant fact is current. Sensitive eligibility answers remain inspectable, and unfamiliar meanings must not be filled merely because a text similarity score is high.

## Profile, presets, and Memories

### Remembering an answer

1. The user answers a missing review question on the website.
2. The sidebar indicates that the question appears answered and enables Remember answer. Readiness feedback should not capture unrelated page values.
3. Clicking Remember explicitly requests capture of that question's answer.
4. Show the captured answer and proposed reuse scope for confirmation.
5. Save only after confirmation, then show a clear success message.

Save all answered questions explicitly requests capture of the answered review questions included in that batch. Show their answers and scopes together before saving. Do not scan and silently save every answer on the page.

### Choose the right destination

- A direct Profile fact, such as a missing GPA, updates the relevant Profile field after confirmation. Confirm replacement if a conflicting value already exists.
- A contextual answer, such as willingness to commute to a particular office, becomes an appropriately scoped Memory.
- Role-specific prepared content stays associated with the selected preset where applicable.
- Keep the active preset visible in a compact control. Freeze the preset and answer-source context for an active fill attempt; define changes to waiting jobs explicitly rather than silently switching an in-progress job.
- Keep full Memory management in Settings. The sidebar focuses on capturing and confirming answers needed by the current application.

### Handle variations quickly and conservatively

Use local matching first: normalize formatting, check exact approved questions, resolve approved question meanings, check context and scope, then match approved answer equivalents to actual options.

Country, subject, timeframe, education level, and negation must agree. A degree abbreviation can resolve to an approved equivalent without treating a graduate GPA as an undergraduate GPA. Willingness to commute to one office must not become a global Yes to relocation.

All applications is the broadest scope, not a substitute for narrower scopes. Narrower company, site, or application scopes prevent inappropriate reuse. Conflicting applicable answers should require review rather than silently choosing one.

Unfamiliar wording is a suggestion requiring confirmation. Optional AI can propose aliases or wording after a user click, with individual approval before saving. Routine reuse must not require an AI request or slow down known-answer filling.

Preserve the existing explicit-consent boundaries for demographic and eligibility information. Never infer these facts from unrelated answers.

## Queue behavior

### Capacity and continuous replacement

Default to **three applications open at once**, configurable from one to five initially. This is a capacity limit, not a requirement to finish an entire batch before starting another job.

- Changing three to five opens exactly two more jobs when at least two are waiting, or one if only one remains.
- If nothing is waiting, explain that the queue has no more jobs to open.
- Reducing five to two keeps existing tabs open. Start no replacements until occupancy falls below two.
- Count loading, filling, login-waiting, blocked, and review-ready owned application tabs toward the limit.
- Keep pending jobs as metadata; do not open all pasted URLs in advance.
- Add links while a queue is running without resetting progress.
- Pause stops new openings while allowing current review, submission confirmation, and recording to continue. Resume reevaluates available capacity.
- Put Stop and other less frequent controls in a clearly labeled secondary area. Stop keeps already opened applications available and explains the outcome.
- Keep any legacy batch mode separate from the default continuous workflow so its semantics cannot leak into the main controls.

### Duplicates and previously tracked jobs

| Existing state | Proposed behavior |
| --- | --- |
| Duplicate pasted URL | Keep one queue entry and report the duplicate. |
| Already queued or open | Open the existing entry instead of creating another. |
| Unfinished tracked application | Offer resume. |
| Previously submitted | Skip by default with an explanation. |
| Previously abandoned | Allow an explicit retry. |

### Abandon and retry

Keep an accessible way to say I cannot continue, including during a stalled fill. Cancel and settle the writer before handing control back. Record Abandoned separately from Submitted.

For a queued job, explicitly abandoning and closing its owned tab releases a slot and advances the queue when running. If closing fails, show recovery and keep occupancy accurate. For an individual job, leave the tab open unless the user also chooses to close it.

## Submission confirmation and tracking

Use the same submission observer for individual and queued applications, with platform-specific evidence behind adapters.

- A user submit action establishes intent; it is not evidence of success by itself.
- Confirm success only with supported confirmation evidence tied to the application, job, tab, frame, and attempt.
- A disappearing form, changed URL, button click, or empty page alone is insufficient.
- Validation errors keep the application open and return the user to the attention list.
- Keep the tracked application's identity through confirmation navigation. The sidebar must not lose its manual confirmation action because the original form disappeared.
- Start with well-tested Greenhouse behavior, then add tested Lever and Ashby confirmation patterns. Treat variable systems such as Workday as separate adapter work.
- Unsupported or ambiguous outcomes remain open for review.

**I submitted this application** is the explicit fallback when automatic confirmation cannot recognize the website's result. Keep it accessible for a tracked unfinished application even if page extraction fails. Store whether success was detected or user-confirmed; do not present an unconfirmed attempt as Submitted.

For a confirmed queued application, save the outcome locally once, close only the owned application tab when appropriate, release capacity, and start the next waiting job. If the completed tab was active, hand off to the next prepared job. Completing a background job must not steal focus.

For a confirmed individual application, keep the tab open by default and offer Close tab.

Google Sheets synchronization follows the local outcome asynchronously. A sync failure should show Submitted — sheet sync needs retry, without blocking the queue or encouraging another application submission. Retries must not create duplicate application records or sheet entries.

## Technical design

Keep TypeScript, strict schemas, React, WXT / Manifest V3, local extension storage, Vitest, and Playwright. Reuse the current storage mechanisms and shared contracts rather than introducing a new persistence layer for this work.

### Shared application controller

Introduce or consolidate a controller that both Fill this page and the queue invoke. It owns lifecycle transitions and derives the available actions. Keep extraction, matching, preview, writing, and verification separate.

Events include Start fill, Login required, Form ready, Field verified, User edited, Finish manually, Submit attempted, Submit confirmed, Retry, Abandon, and Tab closed.

- Identify application records, fill attempts, queue runs, and owned tabs explicitly.
- Verify message sender, frame, and destination before accepting results.
- Reject stale attempt results after cancellation, retry, navigation, or preset changes.
- Make claims, completions, tab creation, and recording idempotent. Repeated clicks cannot create duplicate work.
- Persist important transitions and pending intent. Do not rely on service-worker globals for durable state.
- Reconcile live tabs after worker restart. After browser restart, stale tab IDs must never authorize closing an unrelated tab.
- Use runtime validation, versioned schemas, and migrations for changed records and messages.
- Update consumers and [contracts](CONTRACTS.md) in the same implementation change.

The queue controls capacity and scheduling; it does not maintain a second implementation of field filling. Both paths use the same form readiness, Profile, preset, approved Memories, and verification logic. Apply known local answers before optional AI responses. Retry only unresolved eligible fields, with bounded attempts and preservation of user edits.

Use [Chrome's service-worker lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) when designing restart recovery.

## Performance and privacy

- Default to three owned application tabs and initially cap the control at five. Explain that the limit controls open tabs, not guaranteed memory use.
- Measure extension overhead against the same sites opened without active filling. Third-party pages may dominate RAM use.
- Limit simultaneous optional AI requests and avoid large repeated Profile copies.
- Prefer relevant, debounced form observers over repeated full-page scanning. Disconnect observers and timers when attempts finish.
- Bound dropdown waits, readiness checks, retries, and network tasks. Surface delays with recovery actions.
- Keep the sidebar responsive while work happens in other tabs; do not activate tabs just to update progress.
- Preserve credentials, resumes, personal profiles, and exports outside version control.
- Diagnostics may describe adapter, control type, phase, reason code, and build version. Exclude applicant answers and credentials.
- Show a useful build/version indicator and stale-content-script recovery instructions to reduce confusion after extension reloads.

## Implementation sequence

Implement in small, reviewable changes after approval. This is an integration effort, not a wholesale rewrite.

| Phase | Work | Exit condition |
| --- | --- | --- |
| 1. Establish the baseline | Preserve local work, inspect current behavior and contracts, reproduce gaps with controlled fixtures. | Known failures and existing protections are documented in tests. |
| 2. Unify lifecycle handling | Share the application controller, ownership, cancellation, persistence, and transitions. | Standalone and queued entry points produce equivalent fill results and recover predictably. |
| 3. Simplify the sidebar | Pin Fill, compact the summary, consolidate attention controls, retain optional category preferences. | Essential actions remain visible across loading, review, and failure states. |
| 4. Handle login and navigation | Add explicit waiting states and safe resume behavior. | Login does not block unrelated jobs or lose the tracked application. |
| 5. Improve review and learning | Add evidence-based field priorities, Show field, and confirmed Profile/Memory destinations. | Users can finish manually and save correct reusable answers without overwritten edits. |
| 6. Finish queue controls | Verify live capacity changes, adding links, duplicate handling, pause, abandon, and continuous replacement. | Three to five opens exactly two more eligible jobs, with no duplicate claims. |
| 7. Unify submission outcomes | Shared supported confirmation, persistent manual fallback, tab handoff, local tracking and independent Sheets retry. | Failed submission never advances; confirmed completion records and advances once. |
| 8. Harden recovery and performance | Exercise stale results, worker/browser restarts, observer cleanup, accessibility, and resource overhead. | No known blocking recovery failures in the supported test matrix. |
| 9. Measure and package | Benchmark coverage and time savings, update user documentation, produce a versioned installable build. | Results are reproducible and limitations are explicit. |

Before each phase, inspect what the branch already implements. Keep working behavior and avoid rebuilding mechanisms that already satisfy the requirement. Coordinate contracts, shared storage, and manifest changes with the other contributor. Separate clones or worktrees are required for simultaneous editing.

Use focused branches and PRs with a specific owner, affected modules, actual checks, and remaining limitations. Update architecture and roadmap documentation when the implementation changes those decisions.

## Validation and release criteria

### Required scenarios

| Scenario | Expected result |
| --- | --- |
| Fill one supported form | Known answers populate and verified selections remain selected after rerender. |
| Fill after login | No credentials are entered; the application is recognized and can be filled. |
| One queued job requires login | Other open jobs continue preparing; the waiting job can resume. |
| Dropdowns or conditional fields load late | Bounded readiness/recovery handles them or gives an actionable fallback. |
| User edits during rerender or retry | Their non-empty answers survive. |
| A canceled AI response returns late | It cannot overwrite the user or a newer attempt. |
| Save one answer or Save all | Only requested review fields are captured, confirmed, and reused within approved scope. |
| Change capacity from three to five | Exactly two additional jobs open when available. |
| Reduce capacity below current occupancy | Existing applications stay open; no replacement exceeds the new limit. |
| Submit with validation errors | The application is not marked Submitted or closed. |
| Supported submission succeeds | Record once, close only the appropriate owned queue tab, and replace once. |
| Submission result is unfamiliar | Manual confirmation stays accessible; the tab is not closed prematurely. |
| Abandon a stalled job | Writes stop, outcome stays distinct, and capacity recovers correctly. |
| Worker or browser restarts | Restore durable intent without duplicate jobs or ownership based on stale tab IDs. |
| Sheets synchronization fails | Local submission remains recorded and queue progress continues; retry does not duplicate entries. |
| Repeated clicks or retries | No duplicate writes, application records, queue claims, or tabs. |

Include native selects, searchable custom dropdowns, multiselects, uploads, delayed controls, conditional questions, and authentication fixtures.

Use unit tests for transitions and matching, and real-extension Playwright tests with fictional applications for browser behavior. Run repository checks, type checking, unit tests, build, and relevant browser tests for implementation changes. Supervised checks on actual supported sites can supplement fixtures without submitting fictional applications to employers.

Passing controlled tests cannot guarantee every third-party form is bug-free. Publish the supported platform/widget matrix and known limitations. A release should have no known blocking failures in its stated supported workflow.

### Evidence for a portfolio

Measure eligible-field coverage, incorrect-fill rate, time to first review, active user time, total throughput, restart recovery, and extension memory overhead. Use those measured results in resume claims rather than invented percentages.

The engineering story should emphasize verified DOM interaction, reusable scoped knowledge, a persistent Manifest V3 workflow, bounded scheduling, recoverable failures, and accessible review controls.

Prepare a versioned installable package, clear setup and update instructions, privacy and permission explanations, release notes, and synthetic screenshots or a short recorded walkthrough using the existing fixtures. Publishing to the Chrome Web Store is a separate explicit release decision; this proposal does not authorize a store submission.

## Decisions for review

Recommended defaults for owner and collaborator approval:

1. Pin Fill this page at the top and consolidate missing answers and review into one current-application workspace.
2. Use continuous replacement with three open applications by default and an initial configurable limit of five.
3. Allow capacity changes during a queue without closing existing jobs when the limit decreases.
4. Detect supported submission confirmations only after user submission, with an always-discoverable manual fallback.
5. Keep detected submissions open. Advance only after explicit Continue/Submitted or user tab closure; keep standalone tabs open by default.
6. Keep remembering explicit and confirmed, with Profile updates for direct facts and scoped Memories for contextual answers.
7. Keep Sheets synchronization independent from local completion and queue progress.
8. Deliver the work in the phases above, validating each phase before expanding scope.

The owner has authorized incremental implementation. Use the checkpoints above to collect feedback, agree on module ownership, and adjust later increments before proceeding. Publication of this document alone was not implementation approval; the subsequent owner request supplied that approval.

Related project guidance: [shared instructions](../AGENTS.md), [architecture](ARCHITECTURE.md), [contracts](CONTRACTS.md), [roadmap](ROADMAP.md), and [collaboration](COLLABORATION.md).

## Review feedback — 2026-10-20

The owner's follow-up changes the closure default above: detecting submission records its outcome,
but the current queue job remains occupied until the person explicitly closes it or chooses Continue.
This also keeps review from being displaced while the person is saving Memories. Arbitrary sign-in
redirects/new tabs can be manually attached with Use this page for this job. The original description
page/link are kept and company/title similarity alone cannot authorize Profile transfer.

Additional polish adds pinned Stop fill (including later conditional-field writers), guarded document
uploads, a persistent compact application-details toggle, smaller queue/review controls, nested Show
field navigation, Today/Tomorrow start-date choices, and manual employer contact/address fields.
See the [changelog](../CHANGELOG.md) and [contracts](CONTRACTS.md) for the resulting behavior.
