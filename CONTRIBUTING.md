# Contributing to Profile Manager

## Branch and pull-request workflow

- `main`: stable, reviewed changes only. Do not push or force-push directly.
- `integration/*`: controlled integration of verified milestones.
- `feature/*`: isolated functional development.
- `test/*`: QA, fixtures, acceptance workflows, and evidence.
- Keep unfinished M2 and M3 branches isolated until their contracts and acceptance gates are satisfied.
- Open a PR to `main`; describe exact commit SHAs, tests, migration impact, and unresolved risks before merging.
- Prefer **merge commits** for milestone integration to preserve original granular commit history. Use conventional commit subjects (`feat:`, `fix:`, `test:`, `ci:`, `docs:`, `chore:`, `merge:`).

## Verification

1. Run targeted tests while developing; keep the full regression suite for the acceptance gate.
2. Verify on the intended Windows/Linux targets as defined by each milestone.
3. A passing source-test step is **not** the same as a green workflow when required artifact upload fails.
4. Do not waive failures, alter expected hashes, silently skip regression tests, or label unverified features as released.
5. Keep the approved M1 baseline and M2 handoffs reproducible. Avoid modifying previously frozen milestone branches.
6. Do not generate Windows installers except for explicitly approved release gates. Preserve source evidence, SHA-256, and test logs where required.
7. Require conflict resolution, reviewer approval, and successful relevant checks before merging a PR; if checks are unavailable due to infrastructure, document the exception and keep the gate pending.

## Changes and release notes

- Update `CHANGELOG.md` for user-facing features, behavior changes, and release milestones.
- Keep `README.md` and `BUILD_AND_RELEASE.md` in sync with actual build and release behavior.
- Do not commit credentials, session data, browser profiles, proxy passwords, compiled installers, or local application databases.
- GitHub file history and PR reviews are the authoritative audit trail.

## Branch protection

Repository administrators should configure `main` protection/rulesets in GitHub Settings to require PRs and appropriate checks, block force pushes and branch deletion, and establish review requirements compatible with available reviewers.
