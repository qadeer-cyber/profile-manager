# Ultimate 2.0 — unified source PR (draft)

## Source composition

- Codex security foundation: 0723c54251c33732b6c6f45fdf91ac990f831bd3
- Grok stock feasible: 8251394d27bda34fc4625a276e109752a419bec5
- Integrated encrypted CLI, workspaces and proxies: 9dc9fd09c4fdc2aab18d1d3944b87bfae2d738aa
- Chromium/Firefox M8 Linux QA: 66bf4afa2531f5e8dbc925d57bcfc15059fc92e1
- Grok advanced privacy source: f3661292d34e1b69af48cf7ac9569da644be82af

This PR merges advanced privacy on top of Codex-secure M8 QA. It preserves Codex encrypted PMBE v2, backup-stream routes, recovery-lock guards, XPI policies, Firefox SIGTERM grace, and QA Chromium executable resolution. Nonconflicting advanced changes were copied, overlapping server changes reconciled by targeted patches. New Canvas/WebGL page hooks are OFF by default.

## Pre-unification evidence (NOT a combined green test run)

- Secure QA source: unit 134 PASS; stabilization 90 PASS; data recovery 63 PASS; browser runtime 186 PASS (one skip); real Linux Chromium+Firefox M8 2/2 PASS.
- Advanced privacy source: 13 privacy acceptance tests PASS and pinned real-CfT browser tests reported PASS.
- Combined branch: full Windows real-browser and source gates NOT_RUN. GitHub Actions jobs blocked at runner allocation by billing/spending limit.

## Scorecards (independent)

- Strict unified historical matrix: 18 VERIFIED + 20 PARTIAL + 5 UNSUPPORTED; two cloud-only excluded. (18 + 0.5 * 20) / 43 = approximately 65.1%.
- Separate Grok source matrix 31 VERIFIED / 7 PARTIAL / 5 UNSUPPORTED, approximately 80.2%, remains a historical source score only.
- Stock feasible: 23 PASS / 0 FAIL with 7 custom-engine-required criteria excluded.
- M8 remains PARTIAL until actual Windows acceptance; M24/M26 are opt-in experimental page hooks, not custom engines. M25/M27 and guaranteed CAPTCHA-free M42 are unsupported.

## Release gates still open

1. Combined branch compilation and all unit, recovery, stabilization, browser-runtime and privacy regression tests.
2. Real Windows Chromium/Firefox M8 + application UI readback and failure evidence.
3. Encrypted backup downgrade protections and security review.
4. Previous-alpha to candidate offline upgrade data preservation and installed application smoke.
5. SHA-256 artifact and review approval.

This is a DRAFT source-integration PR. No new Windows installer binary has yet been produced in the connected environment. No main merge, installer publish or release is authorized by this PR alone.
