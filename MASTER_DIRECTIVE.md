# MASTER ENGINEERING PROMPT — FULL MULTILOGIN-COMPARABLE PROFILE MANAGER

**Document:** MASTER_DIRECTIVE.md  
**Repository:** qadeer-cyber/profile-manager (private)  
**Audience:** Grok Lead, Browser Engine, Backend, UI/UX, Windows Desktop, Security/QA; Codex continuation engineer  
**Priority:** Product-wide engineering directive  
**Protection:** M1 frozen, M2 scope locked, later milestones approval-gated

> The objective is a commercial-quality, independently engineered Windows browser-profile manager with the fullest verifiable **Multilogin-comparable user-facing feature and workflow parity**. This is not merely a Chromium launcher or a diagnostics dashboard. Do not copy proprietary code, impersonate Multilogin, make unsupported undetectability claims, or substitute mockups for working functionality.

---

# 1. EXISTING PROJECT — DO NOT REBUILD FROM ZERO

- Repository: `qadeer-cyber/profile-manager`.
- Stack: Electron desktop shell, React frontend, Node.js/Express API, SQLite persistence, Playwright Chromium engine, offline Windows NSIS installer.
- Existing capabilities: local profile and proxy management, browser lifecycle, persistence, encrypted proxy credentials, local authenticated API.
- **Accepted M1 SHA:** `d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9`.
- **Windows Build #48:** successful; installed-app checks 45 pass / 0 fail; manual acceptance user-reported.
- **Current M2:** Read-only browser diagnostics, independently assigned and currently approved for work.
- **Canonical M2 contract:** `/workspace/DIAGNOSTICS_CONTRACT.md`, SHA-256 `cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8`. Keep a versioned verified copy in an authorized handoff location; local path alone is not a durable source.
- Sole current M2 backend implementer: agent `bc-ac164b2e`. No duplicate backend work.

**Protected:** `main`, `windows-validation`, PR #1, v0.4.0 tag and release, accepted M1 commit/history, existing encryption formats, validated lifecycle semantics, app ID `local.profilemanager.app`, product name `Profile Manager`, user data `%APPDATA%\profile-manager`. No force-push, history reset, release, merge to protected branches or installer dispatch without separate approval.

# 2. FEATURE PARITY STANDARD

Use Multilogin's **publicly documented browser-profile product** as the comparison reference, not a promise to duplicate proprietary implementations.

A feature is finished only after its real user workflow works end to end, settings persist, frontend/backend/browser behavior agrees, isolation/security hold, error cases pass, Windows packaging is validated when applicable, and manual QA evidence exists.

Maintain a `FEATURE_PARITY_MATRIX.md` recording:
- Official source/reference; expected behavior; current implementation.
- Implemented / Partial / Missing / Blocked classification.
- Component and file ownership; dependencies and risks.
- Milestone; acceptance cases; unit/integration/Windows evidence.
- Gaps requiring custom browser engineering, hosted infrastructure or third-party subscriptions.

Never claim parity from a mock UI, a green mock-only unit test, or an undocumented assumption. Verify URLs before treating them as official/current.

Starting references to validate:
- https://multilogin.com/help/en_US/profile-settings-proxy-section
- https://multilogin.com/help/en_US/profile-settings-fingerprint-section
- https://multilogin.com/help/en_US/browser-profiles
- https://multilogin.com/help/en_US/how-to-export-cookies-using-api
- https://multilogin.com/help/en_US/installing-browser-extensions
- https://multilogin.com/help/en_US/workspace-roles-and-permissions
- https://multilogin.com/help/en_US/playwright-automation-example

---

# 3. MODULE A — COMPLETE BROWSER PROFILE MANAGEMENT

## A1. Creation and configuration
Provide quick and advanced profile creation with: profile ID/name/notes, icon/avatar, tags and colors, folder, browser/core and version (only genuinely supported options), platform settings, user-agent, proxy, browser preferences, startup URLs, extension assignment, storage configuration and explicit automation toggle. Professional General / Proxy / Browser Configuration / Extensions / Storage / Advanced sections; sensible defaults and validation.

## A2. Profile listing and organization
Provide a high-density desktop table with name/ID/folder/tags/core/proxy/status/last-used/created/updated/actions, search, advanced filters, sortable columns, saved views when approved, virtualization/pagination, multi-select, context menus, keyboard support and narrow-window handling.

## A3. Lifecycle
Start, stop, restart, graceful close, failure detection, recovery, duplicate-launch prevention, per-launch process identity, race-free locks and cleanup. **Preserve M1:** ordinary last-window close → Stopped; app Stop → Stopped; forced kill → Error; relaunch clears previous error; storage survives. Never replace the proven classifier without separate review.

## A4. Cloning
Offer an explicit **settings-only clone** (fresh storage) versus **copy-with-data** for safely stopped source profiles. One/multiple clones, naming, folder selection, optional proxy reassignment, collision handling, cancellation, data-integrity tests and no unsafe live-database copy. Clone default is an owner-approved product decision, not an invisible change.

## A5. Bulk actions
Validated CSV/JSON bulk create; bulk start/stop; move folders; assign tags/proxies; export; trash; restore; duplicate; copy IDs. Bound concurrency, cancel safely, present per-item progress/errors, preserve independent profile data on partial failure.

## A6. Folder/tag management
Create/rename/move/delete folders; optionally nested folders after approval; search/filter by folder/tags; recycle bin and safe permanent delete with confirmation; SQLite persistence across restarts.

## A7. Isolation and storage
Preserve **cookies, localStorage, IndexedDB, sessions, history, bookmarks, preferences, extension data and other browser user-data state** in independent per-profile directories. Test that one profile's data never leaks into another without an explicit user import/copy. Protect active browser databases from unsafe mutation.

---

# 4. MODULE B — ADVANCED BROWSER CONFIGURATION AND PRIVACY

The UI must distinguish **configured**, **observed**, **effective**, **unavailable** and **unsupported** facts. Never fake a browser characteristic or guarantee anonymity. Current fingerprint-related notes are **research/design only** until separately approved; no implementation of stealth/detection-evasion behavior is authorized by this directive alone.

## B1. Version and user-agent
Show actual Chromium version and user-agent; design user-selectable settings only where supported, plus platform/client-hint consistency, per-profile persistence, validation, independent observation and warnings for incompatible values. Do not mislabel a custom string as the actual binary version.

## B2. Timezone
Host/default vs validated IANA timezone selection, per-profile persistence, browser-side verification, safe save/restart semantics, rejected invalid IDs; optional geographic recommendations only with a legitimate data source. Timezone does not change IP.

## B3. Languages and locale
Locale, preferred languages, `Accept-Language`, language ordering, host/default or explicit user setting, persistence and observed consistency tests.

## B4. Geolocation
Explicit permission/deny/prompt options; user-approved coordinates with validation; per-site permissions; distinguish IP location and browser geolocation. No hidden automatic permission grants.

## B5. WebRTC
Research Default/Real, proxy-compatible privacy policies, selectable restrictions and Disabled; document broken calling/sharing behavior when restrictive; recognized Chromium policy allowlist, absent/conflicting/unavailable reporting, controlled ICE verification. **M2 is observation-only; WebRTC launch behavior requires M4 approval.** No unconditional anti-leak guarantees.

## B6. Display/screen
Real host display mode, window size, viewport, supported device scale/pixel-ratio options, presets, fullscreen, multi-monitor restoration, warnings about impossible dimensions; controlled observation tests.

## B7. Hardware/Navigator
Assess hardware concurrency, memory reporting, navigator platform/languages, media permission behavior, compatibility and genuine observed values. Do not change isolated attributes inconsistently or simulate unsupported hardware.

## B8. Fonts
Host/default fonts, safe availability inspection, actual browser font preferences, persistence, missing-font warnings, layout/readability regression tests. Browser-core font behavior changes need a distinct design review.

## B9. WebGL/GPU
Inspect actual support, renderer/capability information, troubleshooting/privacy settings, performance and compatibility; identify features requiring native browser-core changes rather than claiming a launch flag supplies them.

## B10. Canvas
Research user-visible privacy/default/restricted controls and compatibility; evaluate rendering correctness, cross-session stability, update burden and custom-engine requirements. No silently invented noise or output manipulation.

## B11. AudioContext and devices
Audio/media availability, microphone/camera permissions, device enumeration, supported browser choices, user consent and compatibility. Advanced output transformation requires separate architecture and testing.

## B12. Engine feasibility
Classify every proposal as possible via (1) existing Playwright/Chromium, (2) launch configuration, (3) extensions, (4) custom Chromium, or (5) external/OS infrastructure. A custom fork requires upstream security rebases, reproducible Windows compilation, signing, CI capacity, update policy and rollback. Proprietary Multilogin cores are not available by default.

---

# 5. MODULE C — COMPLETE PROXY MANAGEMENT

## C1. Protocols
HTTP/HTTPS/SOCKS5, with/without authentication, IPv4/IPv6 as supported, strict host/port/protocol/credential/URL validation, duplicate detection and encrypted password storage.

## C2. Saved library
Create/edit/delete, bulk import, non-secret export, grouping, labels, search/filter, assignment/removal, usage count, prior test timestamp/results, exit IP, latency, provider/location metadata. Preserve existing encrypted credentials and never return passwords in routine APIs.

## C3. Bulk import
Support `host:port`, `host:port:username:password`, proxy URLs, CSV and JSON; safely handle delimiters inside encoded passwords; preview, row errors, duplicate handling and partial-result reporting. Never commit real credentials.

## C4. Explicit tests
User-triggered reachability, observed exit IP, latency, DNS/auth/TLS/refusal/timeout errors; no silent TLS bypass. Do not equate a proxy connectivity test with proof of every browser network path.

## C5. Residential/mobile/ISP integration
Design adapters for third-party residential, mobile, ISP, datacenter providers, including sticky/rotating sessions, documented rotation endpoints, provider session identifiers and balance/usage where supported. Use only documented authorized provider APIs and user-owned subscriptions. No fake integrated IP network or fabricated entitlements.

## C6. Provider adapters
Authentication, endpoint discovery, allowed regions, rotation, traffic use, connection checks, error normalization, credentials refresh and secure storage; manual setup fallback where provider APIs are unavailable.

## C7. Assignment lifecycle
Single/shared assignments, bulk reassignment, warnings before deleting an in-use proxy, distinction between saved and current-launch settings, safe application on next supported browser launch.

---

# 6. MODULE D — COOKIES, SESSIONS AND STORAGE

## D1. Cookie workflows
Explicit import/export, supported JSON and Netscape formats if feasible, validation of domain/expiry/Secure/HttpOnly/SameSite and modern attributes, duplicates/overwrite review, per-site and full clear. Treat cookies as sensitive authentication data; never silently harvest or transfer live sessions.

## D2. Storage management
Profile storage size/path/status, user-triggered cleanup, cache/site data actions where safely supported, integrity metadata, safe concurrency and no writing active browser databases.

## D3. Portable archives
Versioned import/export of our own stopped profiles: metadata, folders/tags, compatible data, optional encryption, previews, compatibility, collision handling, path-traversal protection and partial-import recovery. OS-protected secrets may not be portable; do not promise otherwise.

## D4. Backup and restore
Consistent SQLite snapshots, safe browser storage copying, verification, explicit restore approval, recovery and rollback, progress UI. Never restore an unverified backup over a live database.

---

# 7. MODULE E — PER-PROFILE EXTENSIONS

## E1. Library
Add/remove/list, assign to one/multiple profiles, enable/disable when supported, version and permissions, approved unpacked imports, updates, profile-specific persistence and storage.

## E2. Launch compatibility
Account for Playwright default extension switches without breaking M1; test zero/one/multiple extensions, restart, persistence, failed extension, malicious paths and permission conflicts. No unlicensed extension store or silent untrusted installations. Implementation needs historical M5 reapproval.

---

# 8. MODULE F — AUTHENTICATED AUTOMATION API

Build on existing local API: list/create/edit/start/stop/status/assign proxy, explicit automation sessions and permitted connection details, batch status, documented errors. Qualify Playwright, Puppeteer, Selenium where supported, Node and Python examples.

Security: automation defaults **off**, explicit opt-in, CDP TCP loopback-only when enabled, existing token auth, no unauthenticated remote control, no token in query strings, no hidden activation and no privileged generic IPC. Existing `/api/api-token` Settings behavior stays unchanged; M2 does not call it to acquire an automation token. No CAPTCHA bypass, covert account takeover, hidden credential extraction or challenge-evasion integration.

---

# 9. MODULE G — PREMIUM DESKTOP UI/UX

Build an original commercial-grade design system, **not** a copied Multilogin UI or decorative CSS-only restyle: consistent type, density, spacing tokens, navigation, tables, dialogs, icons, restrained motion, focus states, light/dark if supported, accessibility, narrow desktop layouts and clear errors. No giant zoomed cards or placeholder controls.

Required end-to-end screens:
- Dashboard: profiles, running sessions, proxies and actionable events.
- Profiles: searchable/filterable bulk-management table and folders.
- Create/Edit: General, Proxy, Browser, Extensions, Storage and Advanced.
- Proxy Manager: library, providers, tests, assignments and bulk import.
- Extensions: library and per-profile assignment.
- Storage & Backups: archive workflows and verified backups.
- Diagnostics: original approved M2 contract.
- Settings: desktop, browser, automation and privacy.
- Team/Workspace only after real backend/service approval.

Acceptance: complete UI workflows, keyboard and screen-reader operation, focus, zoom/scaling up to 200%, narrow widths, long text, loading/empty/error states, large lists, persistent changes and restart behavior. Every clickable action must be wired to a functioning and tested capability.

---

# 10. MODULE H — TEAMS AND CLOUD (SEPARATE PRODUCT)

Architect genuine identity, workspaces, invitations, owner/manager/operator-style roles, folder ACLs, shared metadata, activity/audit logs, conflict handling, encrypted sync, transfers, revocation and offline recovery. Requires actual authenticated cloud infrastructure, threat model, cost estimate, hosting and migration plan. Never fake cloud features locally, and do not implement as part of M2.

---

# 11. ENGINEERING ARCHITECTURE

Separation of concerns:
1. Electron main/IPC; 2. React UI; 3. authenticated Express APIs; 4. profile domain; 5. lifecycle engine; 6. browser configuration; 7. proxies; 8. extensions; 9. storage/cookies; 10. diagnostics; 11. SQLite and migrations; 12. optional collaboration service; 13. Windows packaging; 14. automated testing.

Use narrow, reviewed contracts; avoid Electron main-process or UI monoliths. Migrations must be versioned, backed up correctly and tested against M1 fixtures and Windows upgrades. Never commit customer credentials, databases or browser data.

---

# 12. GROK MULTI-AGENT OWNERSHIP

- **Lead/Integration Architect:** contracts, branch coordination, review, dependency integration, acceptance evidence.
- **Browser Engine:** Chromium compatibility, launch/browser settings, approved privacy controls, extensions, regressions.
- **Backend:** profile/proxy/storage/bulk/API services, migrations and tests.
- **UI/UX:** design system, workflows, frontend tests.
- **Windows Desktop:** Electron security/native modules, x64 offline NSIS, upgrades, installed smoke, rollback.
- **Independent Security/QA:** strict contracts, authentication, isolation, migration and lifecycle evidence.

**One writer per file/branch.** No duplicate backend agent. Each works on an isolated feature branch; the integration owner reviews and resolves shared changes. Agents must not independently merge or publish.

---

# 13. ORIGINAL MILESTONE GATES

**Required pipeline:** Research → Architecture → Owner Approval → Implementation → Unit Tests → Integration Tests → Windows push CI → Explicit Installer Approval → Installed EXE validation → Manual Windows QA → Milestone Sign-off.

- **M1 Lifecycle:** accepted/frozen.
- **M2 Read-only Diagnostics:** separately authorized, in progress under verified DiagnosticsV1.
- **M3 Locale/Timezone/Language:** historical milestone; **implementation reapproval required**.
- **M4 WebRTC Policy:** historical milestone; **implementation reapproval required**.
- **M5 Per-profile Extensions:** historical milestone; **implementation reapproval required**.

Other full-parity work (profile enhancements, proxy-provider adapters, cookie/archive workflows, premium UI, automation qualification, teams/cloud, custom core) remains an owner-approved backlog without invented historical numbering.

No endless Diagnostics scope growth while major user-facing features remain missing. Do not bundle unrelated engine, migration and UI changes in one opaque diff.

---

# 14. TEST REQUIREMENTS — NO SHORTCUTS

For every approved milestone, run relevant unit, API-contract, real Chromium, lifecycle, proxy, security, persistence, UI, desktop, Windows push-CI and installed-EXE tests (last only after separate authorization); then manual Windows checks.

Core cases:
1. Independent simultaneous profiles.
2. Stop one without stopping another.
3. Settings persist across restarts.
4. Cookies/session isolation.
5. Authenticated proxies.
6. No credentials in logs.
7. Last-window close → Stopped.
8. Forced kill → Error.
9. Relaunch clears previous Error.
10. Clone follows chosen storage mode.
11. Extensions do not corrupt storage.
12. Malformed cookie imports rejected.
13. Archive traversal rejected.
14. Bulk partial failures isolated.
15. Browser settings verified by independent observation.
16. Offline bundled browser launch.
17. Upgrade preserves user profiles.
18. Uninstall retains user data according to policy.
19. Automation-off ordinary launches expose no CDP TCP listener.
20. Existing M1 assertions remain unchanged and pass.

Each packet: exact SHA, files, requirements, commands, pass/fail/skip counts, real vs mocked evidence, risks, screenshots where useful, known gaps and next approval gate. Never invent results.

---

# 15. PARITY SCORECARD

Use statuses: NOT STARTED / IN DESIGN / IMPLEMENTING / PARTIAL / READY FOR QA / VERIFIED IN SOURCE TESTS / VERIFIED IN WINDOWS INSTALLER / MANUALLY ACCEPTED / BLOCKED EXTERNAL SERVICE.

Track separately:
- Local desktop browser-profile workflows.
- Browser-core work requiring substantial native engineering.
- Commercial provider/cloud services requiring infrastructure and subscription.

No unsupported 100% identical core, invisibility or undetectability claims.

---

# 16. PERFORMANCE AND STABILITY

Measure 1, 5, 10 and 25 simultaneous profiles where machine capacity permits, plus larger libraries. Record app startup, browser launch, UI responsiveness, CPU/RAM, DB queries, bulk latency, shutdown and resource leaks. Use bounded concurrency and cancellation. Set performance thresholds only after a measured baseline on documented hardware. Diagnostics must not itself cause appreciable overhead.

---

# 17. PERMANENT SECURITY AND DATA RULES

Protect browser data, cookies, sessions, proxy passwords, encryption keys, archives, API tokens, process ownership, logs and database backups. Least privilege, redaction, explicit user permission for sensitive operations, no hidden browsing collection or telemetry without consent. No credential harvesting, CAPTCHA bypass, stealth tracking, unauthorized cross-profile copying or stealth-evasion implementations. Security/privacy features must be validated, not merely marketed.

---

# 18. REQUIRED LEAD DELIVERABLES

**A.** Feature-by-feature Multilogin parity matrix.  
**B.** Current and target system architecture.  
**C.** Prioritized engineering backlog with concrete file/component estimates.  
**D.** Milestone plan and objective QA gates.  
**E.** Grok agent/branch/file ownership matrix.  
**F.** Full desktop UI/UX specification.  
**G.** Browser settings and native-core feasibility report.  
**H.** Security/privacy/data-protection plan.  
**I.** Automated/Windows installer/manual QA matrix.  
**J.** Continuously updated verified completion report.

---

# 19. IMMEDIATE EXECUTION ORDER

1. **M2 HOLD IS LIFTED:** Continue already authorized local M2 coding against the verified DiagnosticsV1 contract. Preserve all in-flight Grok work. M2 contract and scope remain locked.
2. In parallel, Lead and Codex may conduct **read-only** full-parity analysis; no duplicate M2 code.
3. Create the master parity matrix and prioritized backlog, identifying existing vs missing features.
4. Prepare concrete implementation packets for high-value next user-facing milestones.
5. Ask owner approval before any M3/M4/M5 or new parity-pack implementation, merge, release, installer dispatch or protected-branch change.
6. After approval, implement real workflows and preserve all validation gates. Do not restart from zero or replace M1.

**Exception to earlier no-push restriction:** Owner explicitly allows commits/pushes **only on already assigned M2 feature branches** for durable GitHub preservation under Section 20. This does not mean M2 is accepted or that GitHub installer CI is authorized.

---

# 20. GITHUB-FIRST DEVELOPMENT AND CODEX CONTINUATION (OWNER-APPROVED)

This section exists because Grok sessions can hit usage limits. **GitHub—not ephemeral /workspace—is the durable source of code and handoff information.** Never leave the sole copy of implementation progress on the shared computer.

## 20.1 Authorized branches

Protected baseline `d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9` must remain unchanged.

Only existing approved M2 agents may push to their assigned branches:
- Backend: `feature/m2-diagnostics-backend` (sole agent `bc-ac164b2e`).
- UI: `feature/m2-diagnostics-ui`.
- QA: `test/m2-diagnostics-acceptance`.

No agent may push a shared integration branch, `main`, `development/v0.5.0` or `windows-validation` without new authorization. **No merges, tags, releases, installer dispatch or force-push.**

If a feature branch does not exist, create it only from the accepted M1 SHA or owner-approved descendant; don't overwrite another person's branch.

## 20.2 Safe periodic WIP commits

Before each checkpoint, perform:

```bash
git branch --show-current
git status --short
git diff --check
git diff
# Stage specific approved source/test/docs paths only:
git add <explicit-allowed-files>
git diff --cached --check
git diff --cached
git commit -m "wip(m2): describe actual change"
git push -u origin <assigned-feature-branch>
git rev-parse HEAD
```

Before committing, inspect for secrets, access tokens, private keys, customer data, SQLite user DBs, Chromium profile directories, cookie exports, proxy credentials, certificates, binaries and generated installers. Never run a blind `git add .` or push private artifacts. Do not amend/force-push to rewrite shared work.

If tests have not passed, mark clearly **WIP / UNVERIFIED**, with failures and missing evidence. A pushed WIP SHA is not approval to integrate or release.

## 20.3 Agent handoff documentation

Each owner must maintain a scoped handoff file, coordinated by Lead to avoid file collisions, e.g.:

- `docs/handoff/m2/backend.md`
- `docs/handoff/m2/ui.md`
- `docs/handoff/m2/qa.md`

Handoff must record remote branch/SHA, last successful baseline, contract SHA, modified files, completed/partial features, tests with exact results, known bugs, security blockers, one precise next action, and outstanding approvals. No secrets, logs containing credentials or user session data.

## 20.4 Codex takes over when Grok limit ends

1. Read `MASTER_DIRECTIVE.md`, `AI_HANDOFF.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`, `BUILD_AND_RELEASE.md`, `docs/v0.5.0/M2_PLAN.md`, `docs/v0.5.0/RESEARCH.md` and the **verified full DiagnosticsV1** contract.
2. Fetch the latest GitHub feature branches. Record the remote heads and SHA of each.
3. Inspect each agent's handoff, commit history and real diffs. Do not assume latest WIP is test-passing.
4. Check each branch descends from frozen M1 and has no surprise files/secrets.
5. Coordinate explicit **single-writer takeover**: Grok owner stops editing before Codex modifies that branch.
6. Resume only the **existing authorized M2 scope** on the appropriate branch. Do not quietly start M3/M4/M5 or broad parity modules.
7. Run unit/contract/integration/security and unchanged M1 lifecycle suites. Fix with forward commits; never reset or force-push.
8. Commit/push only to the branch whose ownership has been explicitly handed over; report exact SHA, tests and remaining blockers.
9. Stop at new-scope, integration, installer-dispatch, merge and release gates for owner approval.

Codex is the continuation engineer, not a substitute for contract review or independent QA.

## 20.5 Session-limit shutdown checklist

Each Grok agent posts before stopping:

```text
AGENT ROLE:
REPOSITORY:
ASSIGNED BRANCH:
LAST PUSHED REMOTE SHA:
LAST COMMIT:
FILES CHANGED:
TEST COMMANDS AND PASS/FAIL/SKIP:
DONE VS WIP:
BLOCKERS:
NEXT EXACT IMPLEMENTATION STEP:
CAN CODEX SAFELY TAKE OVER? YES/NO
```

Say YES only if the latest changes are successfully pushed and the Grok agent will no longer edit that branch. If push fails, preserve the local working tree, report the exact error and do not claim GitHub is current.

## 20.6 Integration and release protection

Normal source CI may run on an authorized feature-branch push if configured; record results. **Installer-specific workflow dispatch still needs explicit owner approval.** No PR merges, protected branch updates, unsigned public publishing or release tags without separate authorization.

---

# FINAL MISSION

Build **Profile Manager** into a genuinely comprehensive, polished, reliable, independently engineered Windows desktop browser-profile management application with Multilogin-comparable practical features and workflows:

- Full profile management and isolation.
- Browser settings and privacy controls subject to verification/approval.
- Proxy library and authorized provider integrations.
- Cookies, storage, backups and safe portability.
- Per-profile extensions.
- Local authenticated automation API.
- Bulk actions and premium desktop UI/UX.
- Optional independently engineered team/cloud service.
- Reliable offline Windows installation, upgrade and data retention.
- Objective source, installer and manual QA evidence.

**NO FAKE FEATURES. NO EMPTY BUTTONS. NO UNVERIFIED PARITY CLAIMS. NO BREAKING THE FROZEN M1 BASELINE.**

**END OF MASTER PRODUCT ENGINEERING DIRECTIVE — GITHUB CONTINUITY EDITION.**
