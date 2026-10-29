# Windows test strategy (§18)

| Scenario | CI (windows-2022) | Latitude 5480 |
|----------|---------------------|---------------|
| Unit + launch-plan tests | VERIFIED via workflow | BLOCKED |
| Native Chromium spawn smoke | PARTIAL (headless CI limits) | Owner |
| Firefox plan tests | VERIFIED argv tests | Owner |
| Full offline EXE install | Alpha.3 frozen; preview §19 only | Owner |
| HD 620 GPU / 8GB perf | NOT measured in CI | BLOCKED |

Workflow: `.github/workflows/dedicated-browser-engine-win.yml`
