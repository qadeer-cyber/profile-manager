# AZWAH Ultimate 2.0 validation

The baseline is merge commit `a0ba65c8671a8915ce35d6bed54a58d97df58003`. Its Windows native and installer acceptance workflows passed before this change.

## Feature dependencies

| Interface | Existing API or desktop surface |
|---|---|
| Profiles, filters, selection, Trash | `/api/profiles`, `/api/profiles/table`, `/api/bulk/jobs`, `/api/trash` |
| Proxy inventory, tests, profile assignment | `/api/proxies`, `/api/proxy/test`, profile proxy-switch endpoints |
| Profile validation and observations | `/api/profile-config/validate`, `/api/profiles/:id/hardware` |
| Folders, workspaces, templates, extensions | Existing resource routes and per-profile assignments |
| Updates | Electron updater IPC, GitHub Releases metadata and verified staging |
| Backup, licensing, automation | Existing server routes, isolated profile storage and edition rules |

## Fingerprint capabilities

A configured value is a request. Applied evidence requires a runtime that implements the setting. Observed results require a live browser with an available observation context.

| Surface | AZWAH capability |
|---|---|
| WebRTC | Existing Chromium IP-handling policies and mapped Firefox preferences. ICE behavior depends on the route and runtime. |
| Timezone | Host, custom IANA where supported, or verified proxy location for applicable runs. Stable Chrome edition may require proxy location for a proxied launch. |
| Geolocation access | Browser default, permit or block where the runtime implements the policy. |
| Geolocation data | Verified proxy location or manual coordinates and accuracy where supported. |
| Browser languages | Host or an ordered list using the browser settings validator. |
| Screen | Native window or supported presets and custom bounds. Playwright viewport and scaling depend on runtime. Physical screen substitution is unavailable. |
| Font data | Host fonts or restricted local-font API access in supported Chromium runtimes. |
| Media devices | Observed devices or restricted camera and microphone access. Custom device identifiers are unavailable. |
| Navigator | Runtime-validated user-agent presets and read-only platform, CPU and device memory observations. |
| WebGL and WebGPU metadata | Read-only vendor, renderer and adapter observations if the browser exposes them. |
| WebGL graphics | Stock behavior or Chromium WebGL restriction. Existing experimental readback hooks have narrower Playwright scope. |
| Canvas | Stock browser output. Existing experimental Playwright readback hook is separate from full-runtime Canvas behavior. |
| AudioContext | Stock browser output with read-only render evidence where available. |
| Port scan protection | Existing browser private-network protections. Per-profile result substitution is unavailable. |
| Verification | Profile editor requests the supported hardware and consistency report and can export structured JSON. |

## Publish a future version

1. Set the candidate version in `electron-builder.ultimate-stable.cjs` and merge through the normal review and Windows CI process.
2. Record the main-branch native validation and installer acceptance run IDs. Download the acceptance candidate and verify the manifest and SHA-256.
3. Qualify the exact candidate on an isolated Windows install. Exercise discovery, corrupted download rejection, verified staging, the user-approved Windows installer handoff and retained profile data from a distinct eligible prior version. The installer CI's rebuilt-legacy upgrade tests database retention independently of release discovery. Keep these results separate.
4. After explicit publication approval and successful release-compatible A-to-B qualification, dispatch **Publish verified AZWAH release** on `main` with the exact version and run IDs. The workflow verifies the matching candidate and creates an `azwah-v<version>` GitHub release with the installer, checksum and build manifest.
5. Verify the published release and update discovery from a previous eligible installation. The installer is unsigned. The application stages and reveals the verified file, and the user runs the installer through the normal Windows trust prompts.

Main pushes run acceptance and upload a temporary candidate. Publication requires manual dispatch.
