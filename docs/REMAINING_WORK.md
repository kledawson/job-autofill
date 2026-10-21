# Workflow follow-up handoff — 2026-10-20

The collaboration branch is `codex/redesign`, renamed from `codex/application-queue` for sharing
this work in progress. This snapshot is not a release or a merge into main.
The owner requested a credit-conscious wrap-up; further feature expansion and repeated broad checks
are deferred. Earlier checkpoint changes in this checkout have been preserved.

## Implemented in this pass

- Stop fill beside Fill this page, including cancellation of later conditional-field writers before
  enabling manual review. Answers remain on the page.
- Upload attempt guards for recreated/cleared file inputs and attachment-table recognition. The
  extension prevents repeat attempts; it does not delete duplicate attachments already on the website.
- Collapsible application details/submission controls with a saved preference, compact queue/review
  cards, and Show field navigation that handles nested scrolling and remains available during filling.
- Today/Tomorrow start-date choices resolved at fill time; fixed dates and the two-week default remain.
- Employer contact/address fields stay manual rather than using personal Profile facts, global contact
  Memories or AI guesses.
- Submission detection records success and retains the tab/queue slot. Explicit Continue/Submitted or
  user closure advances the queue. Moving on does not implicitly retry a failed Sheets write.
- Explicit Use this page for this job recovery for redirects/new tabs. It preserves the original
  description tab/link and binds a fresh attempt to the selected destination, including worker recovery.
- Same-job tracking query/hash changes no longer block explicit Memory capture. Different jobs still
  require an explicit handoff; company/title similarity alone does not transfer Profile data.

## Remaining before publication

1. **Real-site acceptance:** sign in to ClearCompany manually and check the actual upload and employer
   fields. Codex reached its sign-in screen; regression coverage uses fictional reproductions. Test
   representative authenticated redirects/popups on other employers too. Save Memories before Submit:
   keeping a tab open cannot restore fields that the website itself removed after submission.
2. **Fresh full browser run:** the broad regression run encountered a Chromium renderer crash in the
   new test group. The three original new cases passed in isolation. Final focused checks cover the
   added conditional-writer cancellation fix; these do not replace a clean full-suite run.
3. **Refresh release evidence:** rerun `npm run benchmark`, `npm run release:package`, and
   `npm run test:release` after the final source is approved. Existing benchmark numbers describe the
   earlier checkpoint build; the old ZIP/checksum must not be presented as this follow-up build.
4. **Review and publish:** inspect the complete dirty diff, including earlier checkpoint work, then
   commit/push to the feature branch only when requested. Use a reviewed PR for main. Real Google
   OAuth/account access still requires separate live verification; simulated API tests are not that proof.

## Design boundaries and later options

- Login/CAPTCHA and website submission remain manual. Unfamiliar destinations require explicit
  selection; automatic association by title/company is intentionally excluded.
- Employer contacts/addresses are intentionally manual. A future employer-specific data model would
  need its own scoped storage and confirmation flow rather than reusing personal contact Memories.
- An uncertain or removed upload needs manual inspection/upload, or a refreshed form before retry.
- Broader employer coverage and user review-time/RAM measurements remain follow-up work. No
  claim of universal coverage, zero bugs, or measured real-world application throughput is made.

See the [changelog](../CHANGELOG.md), [architecture](ARCHITECTURE.md),
[contracts](CONTRACTS.md), and [review guide](RELEASE_REVIEW.md).

## Validation at wrap-up

- Repository/docs checks, TypeScript checks, final production build and whitespace checks passed.
- Final Vitest run: **493 tests passed**.
- Final focused Chromium run: **4 tests passed**, covering the integrated upload/review/Stop flow,
  personal-versus-employer facts, relative dates, explicit new-tab handoff/worker recovery, and stopping
  a standalone conditional writer after its initial fill had already finished.
- Earlier broad Chromium run: **61 passed, 1 skipped, 1 renderer-crash failure and 2 serial cases not
  run**. The affected new group passed separately. The final cancellation-drain fix was added after
  that broad run and verified by unit/focused browser checks; a fresh complete run is deferred.
- Synthetic screenshots are local/ignored in `local-data/fill-controls-screenshots/`.
- Benchmarks, refreshed ZIP/checksum validation and a fresh complete browser rerun were deliberately
  deferred at the owner's request. No live application was submitted during these checks.
