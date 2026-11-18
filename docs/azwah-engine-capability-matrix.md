# Azwah engine capability matrix

Evidence baseline: 785b38b46395ad702ae3d6c2a363683116a5530d.
Scope: current Stable Chrome runtime and inspected branch checkpoints. Vendor documentation describes advertised controls, not independent comparative test results.

| Layer | Capability | State | Scope and evidence |
| --- | --- | --- | --- |
| A | Concurrent profiles, cookies, local/session storage, IndexedDB, Cache Storage, service workers, relaunch | VERIFIED | Two signed Chrome processes, separate user-data directories and controlled origin. Windows hardening CI 42867919418. |
| A | Profile editing, workspaces, grouping, bulk import, backups and extension assignment | IMPLEMENTED | Application paths exist. Full installed acceptance and Chrome Web Store workflows still need qualification. |
| B | Signed browser identity, UA presets, ordered languages and locale | PARTIAL | Stock signed executable verified. Explicit UA presets use CDP and should not be generalized to all contexts. Browser-observed locale/UA testing is maintained separately. |
| B | Timezone and geolocation | PARTIAL | Manual location and DST verified across tabs and relaunch. Automatic regional authentication, IP/GeoIP, rotation and worker coverage are open. |
| B | Screen, viewport, DPR, font/camera/mic restrictions | IMPLEMENTED | Supported Chrome arguments, viewport emulation, and permissions. No guarantee for OS display, font rasterization, or device identity. |
| B | Coherent canvas, AudioContext, GPU, WebGL/WebGPU, fonts, hardware identity masking | UNSUPPORTED | Stable defaults expose genuine behavior. WebGL restriction and experimental page hooks do not create engine-wide masking. |
| B | Automation visibility | PARTIAL | The browser uses a private pipe for managed emulation. Explicit automation and headless have distinct behavior. No invisibility claim. |
| C | HTTP, WS, WSS, IPv6 loopback routing and proxy outage | VERIFIED | Controlled Windows loopback fixture. This does not certify public egress. |
| C | Restricted WebRTC | PARTIAL | Preference and switch together passed local ICE/STUN observation. The switch alone emitted a UDP candidate. Public-network captures remain open. |
| C | Public DNS, IPv6, STUN, WSS, UDP and QUIC, authenticated regional routes | IMPLEMENTED | Browser restrictions and credential-gated regional harness exist. Public-network proof is missing. A shared chrome.exe firewall rule cannot identify an Azwah profile. |
| D | Historical Windows installer, upgrade, database retention and uninstall | VERIFIED | Windows Server 2022, specific artifact hashes, CI 42826389928. |
| D | Windows 10/11 x64 clients, 8 GB and Intel GPU resource behavior, installed licensing | IMPLEMENTED | Client acceptance, hardware measurement and complete installed licensing evidence remain open. |
| D | Native release and reproducible signed distribution | UNSUPPORTED | No qualified native engine or authorized code-signing material established. |

## Branch evidence and engine choice

- Ultimate 2 integration and local-completion branches contain the profile, workspace, backup and stock launch foundation. Ultimate 3 unified `fb0a597012e4` records managed Firefox and M20 evidence. Firefox results do not qualify Chrome. Track A `662131e2953c` records fingerprint work, and the Track B and Track C branches carry automation/proxy and profile/workspace work.
- Stable proxy branch `69a5b84fd30a`, Stable release `4a45831209cb` and hardening are the maintained stock Chrome path. They use installed Google-signed Chrome x64 and independent Azwah profile directories. Chrome stays external and updates through its own channel.
- Prototype `dccf304ae0f8` is a sandboxed Electron renderer experiment. It is a different runtime.
- Native integration `50560c25b6e6` and bounded parallel experiment `4d9fc944d76f` show build experimentation. The checked-in native patch changes branding, startup receipt, ICU and Windows timezone monitoring, device geolocation, proxy setup, network context, preloading and renderer preferences. It does not implement browser-engine fingerprint masking. The pinned build baseline is not a qualified executable.

## Vendor benchmark

- [Multilogin](https://multilogin.com/help/profile-settings-fingerprint-section) documents persistent Canvas noise as an option and controls spanning network, time, language, device and graphics.
- [GoLogin](https://support.gologin.com/en/articles/14810056-profile-fingerprint-settings) documents per-profile Navigator, font, media, hardware, Canvas, WebGL, AudioContext and WebRTC controls.
- [AdsPower](https://www.adspower.com/blog/how-adspower-builds-browser-fingerprints) describes its Chromium C++ changes across rendering, audio, hardware and fonts. This is the vendor's claim.
- [Dolphin Anty](https://dolphin-anty.com/blog/en/what-different-digital-fingerprint-settings-mean/) documents configurable Canvas, WebGL, language, timezone, geolocation, device and network signals.

## Native engine requirements

Retain Stable Chrome as a separate edition. A native edition needs an explicit, versioned privacy policy passed to browser, renderer, GPU and network processes through trusted IPC. Any deterministic rendering protection must cover observable APIs consistently, including workers and offscreen paths. Keep GPU capability reports consistent with actual enabled features, and keep permissions, TLS, sandbox and security updates intact. Use isolated profile stores and migration by explicit import with rollback.

Rebase reviewed patches on a supported Chromium stable revision and track security advisories and emergency updates. Pin source, toolchain, build inputs and manifests. Measure cold and incremental build times, output size, CPU, memory and disk on a persistent authorized worker before attempting release builds. Qualify on Windows 10/11 x64 and representative graphics hardware. Add Blink/browser tests for API consistency, renderer/worker propagation and policy lifetime, plus packet-level network acceptance and installed upgrade tests. No verified prebuilt distribution with these Azwah patches, compatible data migration, and established redistribution rights was found. No new native build was started.

For process-wide egress, a future WFP policy needs a separate trustworthy per-profile network identity, both address families, cleanup and crash handling, and controls that leave personal Chrome and host networking alone. It requires independent validation and authorization before OS policy installation.
