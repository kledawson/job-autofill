# Contributing

Read [AGENTS.md](AGENTS.md) first. It is the source of shared rules for humans and coding assistants.

## Task workflow

1. Create or claim an issue with scope, files/modules, acceptance criteria, and dependencies.
2. Update your clean local `main` and create a branch:

```sh
git switch main
git pull --ff-only origin main
git switch -c codex/profile-editor
```

Other agreed names such as `feature/form-detection` are fine. One branch per task; do not share a working folder across simultaneous assistants.

3. Implement within scope. Coordinate shared contract or dependency changes in the issue/PR.
4. Run `npm run check` and any application checks added by the scaffold milestone.
5. Inspect `git diff` and stage only intended files. Commit and push your branch.
6. Open a PR using the template. Request the other contributor's review.
7. After CI and review pass, merge the PR, delete the remote feature branch, and start the next task from updated `main`.

If `main` changes during your work, commit your work first, fetch, and merge `origin/main` into your task branch. Resolve conflicts, inspect behavior, and rerun affected checks. Avoid force-pushing shared branches.

## Before requesting review

- Acceptance criteria are satisfied or incomplete items are explicit.
- Behavior is validated with appropriate tests or manual checks.
- No personal applicant information, credentials, generated builds, or unrelated edits are committed.
- Consumers and docs are updated when contracts change.
- The PR describes what changed, why, and which checks actually ran.

## Assistant handoff

Provide the assistant the issue, current branch, scope, acceptance criteria, and shared files that need coordination. Ask it to read `AGENTS.md` first. A suggested prompt:

> Read AGENTS.md and the linked design docs. Implement the assigned issue on this task branch. Preserve unrelated changes, coordinate shared contracts, and run the relevant checks. Summarize the final diff and validation before requesting review.
