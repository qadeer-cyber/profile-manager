# Changelog

This project records changes by **verified milestones**. Git tags and package versions are not inferred from branch names. Release artifacts are separate from source acceptance.

## Unreleased — M1 integration to `main`

### Added and validated

- Native Windows/Electron workflow, with the optional offline installer gated behind `build_installers=true`.
- Persistent Chromium profile lifecycle, process-ownership and termination-evidence handling.
- Browser profile and proxy management, UI and API test coverage, and regression checks.
- Documentation describing building, development, architecture, and release procedures.

### Verification

- Source baseline: [`d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9`](https://github.com/qadeer-cyber/profile-manager/commit/d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9).
- Last recorded successful Windows native validation of that baseline: [Actions run #48](https://github.com/qadeer-cyber/profile-manager/actions/runs/39263296226).
- This integration preserves the main-branch CI commit and resolves the overlapping workflow in favor of the newer verified M1 version.
- No application source files are changed beyond the verified M1 tree by this integration.

### Not included

- **M2 DiagnosticsV1:** separate backend/UI/QA branches; both platforms passed the executed source tests in [run #52, attempt 2](https://github.com/qadeer-cyber/profile-manager/actions/runs/40533634628/attempts/2), but GitHub artifact-upload quota prevented formal evidence upload. M2 is **not signed off and not part of this integration**.
- **M3 locale/timezone/languages:** separate, in-progress feature branch. Not part of this integration.
- No installer build, version bump, or new release tag is claimed here.

## Earlier work

See Git commit history, [BUILD_AND_RELEASE.md](BUILD_AND_RELEASE.md), and [AI_HANDOFF.md](AI_HANDOFF.md) for prior Windows validation and release candidate history.
