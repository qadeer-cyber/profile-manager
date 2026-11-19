# Windows 10 / 11 client qualification (x64, 8 GB RAM)

The CI gates run on GitHub's free **Windows Server 2022** runners (4 vCPU, 16 GB, no GPU, no camera or microphone, a non-interactive desktop). Server shares the Windows 10/11 kernel and Chrome Stable build, but it is not a client SKU. Some results can only come from a physical Windows 10 or 11 PC. This checklist separates the two. **No installer is published as part of this work.** Run it with a CI-built test installer from the `azwah-ultimate-stable-chrome` workflow artifacts.

## What Windows Server 2022 CI already covers

| Area | Gate | Test |
|---|---|---|
| Fresh per-user install, in-place upgrade from a pinned predecessor, uninstall keeps profile data | Installer acceptance | workflow steps 6–14 |
| Installer SHA-256 recorded, offline install (Playwright hosts blocked) | Native gate | "Record SHA-256", "Block Playwright download hosts" |
| Electron app start, installed-layout UI check (row heights, menus) | Native + installer | Electron desktop smoke; installed visuals |
| Real Chrome Stable launch, stop, restart, crash recovery | Installer acceptance | `chrome-stable-windows-live`, `m17-crash-recovery` |
| Proxy (HTTP + authenticated SOCKS5) exit verification and DB-IP timezone following | Installer acceptance | `chrome-stable-dbip-windows` (now also per-category verification) |
| Live fingerprint verification on two simultaneous profiles, restart persistence, isolation | Native gate | `fingerprint-live-windows` |
| Bookmarks import/export, cookies, extensions, backup/restore | Native gate | `test:productivity` |
| Update download, checksum refusal of a tampered installer | Native gate | `update-loopback-e2e` |

## What needs a physical Windows 10 / 11 PC

Server cannot show these:
- **Client-hint `platformVersion`.** Server 2022 reports its own value, so Device Identity offers only *Match this computer* there. The Windows 10 / Windows 11 presets need a client.
- **SmartScreen / Mark-of-the-Web** behavior of an unsigned or self-signed installer downloaded in a browser.
- **Real GPU, camera, microphone, audio devices.** WebGL "Real" metadata, media enumeration with devices and audio output are only observable with real hardware.
- **8 GB RAM behavior.** The runners have 16 GB. Memory pressure, the launch memory threshold and how many profiles fit need a real 8 GB machine.
- **Interactive desktop.** Window placement, multi-monitor, DPI scaling (125%/150%), focus behavior, tray icon and notifications.
- **Antivirus other than Defender**, corporate proxies, and standard-user (non-admin) accounts with folder redirection.

## Checklist

Record each result as **Pass / Fail / Not tested**, with the Windows build (`winver`), RAM, GPU and display scale. Save screenshots for any Fail.

### A. Install and update
1. Download the CI test installer in Edge. Record the SmartScreen prompt and verify the SHA-256 matches the workflow log.
2. Install per-user without admin rights. The app starts and the profile list renders: rows are 48 px (or about 41 px in Compact rows), and the light and dark themes are both correct.
3. Install the newer CI build over it. Profiles, proxies, settings and the profile database are kept.
4. Uninstall. Profile data remains in `%APPDATA%` unless removed on purpose.

### B. Device identity (client-only)
5. On Windows 11: create a profile with **Windows 11 desktop** and launch it with Chrome Stable. Verify → *Device identity* is **Pass**, and the client-hint `platformVersion` is 13 or higher.
6. On Windows 11, **Windows 10 desktop** is listed but disabled with the client-hint reason. On Windows 10 the opposite applies.
7. Restore a Windows 11 profile backup on a Windows 10 PC. The preset shows **Warning**, and the profile stays editable.

### C. Fingerprint verification on real hardware
8. Default profile: Verify. No camera, microphone or local-fonts prompt appears, and the report is observed (the 58cad4b fix).
9. WebGL **Real**: metadata shows the real GPU and is marked *Real only*. WebGL **Restricted**: **Pass** (no context).
10. Media devices **Real** with a webcam attached: enumeration lists devices. **Restricted**: labels are hidden and media capture is **Pass** (NotAllowedError).
11. Timezone and languages set manually: **Pass**. Changing one while the profile runs shows **Warning** until relaunch.
12. Proxy with location *Follow proxy*: timezone matches the proxy location. Geolocation is reported only if the site permission is granted.

### D. Resources (8 GB RAM)
13. Launch profiles one by one until the launch memory threshold refuses with a clear message. Record how many ran and the free memory reported.
14. With 4 profiles running for 30 minutes: no app crash, CPU readings appear after the second sample, and stopping all releases the locks (no `.pm-lock` files left).

### E. Desktop behavior
15. At 125% and 150% display scale the table, toolbar and dialogs are not clipped, and the three-dot menus open inside the window.
16. With multiple monitors: *Remember window* restores a profile window on the same monitor.
17. Sleep and resume with profiles running: they are still running, or are reported as stopped, never stuck as "running".
18. A standard user account with a redirected Documents folder: install, launch and backup all work.

### F. Data safety
19. Bookmarks: import an Edge or Chrome HTML export into a stopped profile and launch it. The bookmarks appear in Chrome's bookmark manager, and re-importing adds nothing.
20. Backup (encrypted) and restore on a second PC. Profiles launch and cookies and bookmarks are present.
21. End `chrome.exe` from Task Manager. The app reports the crash, and the profile can be relaunched without manual cleanup.

## Sign-off

| Machine | Windows build | RAM | GPU | Result | Tester | Date |
|---|---|---|---|---|---|---|
| | | | | | | |

A release needs every item in A–C and F passing on at least one Windows 10 and one Windows 11 PC, and D and E on at least one 8 GB machine.
