# Native Azwah Chromium engine

The native build starts from the Chromium browser source and retains the upstream browser shell, sandbox, profile services, and extension framework. Ultimate continues to offer its existing compatibility engines. The Electron-based Azwah Privacy Engine is experimental. Its runtime identifier and profile data directory remain stable.

## First build

Use an x64 Windows worker with a dedicated NTFS workspace, at least 100 GiB free, at least 8 GiB RAM, and the Visual Studio C++ workload, ATL/MFC, SDK and debugging tools required by the selected Chromium revision. A persistent checkout and incremental build cache are important for security patch turnaround. The worker needs outbound access to Chromium and depot_tools repositories and to the dependency hosts referenced by Chromium's DEPS and hooks.

Select a security-supported stable Chromium revision, pin its full upstream SHA, and check out a compatible depot_tools revision. Initialize depot_tools on the worker before running the baseline script. Run from the profile-manager repository with an existing, empty checkout directory.

```powershell
./scripts/build-native-chromium-baseline.ps1 -Workspace C:\src\azwah-baseline -DepotTools C:\src\depot_tools -ChromiumCommit $ChromiumSha -DepotToolsCommit $DepotToolsSha
```

The script builds upstream `chrome` and `mini_installer` targets and writes `BASELINE-MANIFEST.json` with the pins and SHA-256 values. This establishes the compiler and packaging baseline. It does not install or publish anything. The existing Electron and NSIS workflow builds the experimental payload and has no Chromium source checkout, compilation, or native browser signing stage.

[Chromium Windows build requirements](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/windows_build_instructions.md)

## Source changes and profile integration

| Area | Implementation boundary |
| --- | --- |
| Product identity | Give the fork its own build-time brand, icons, executable and installer metadata, application model ID, updater ID, and registry and protocol registrations. Exercise installation alongside Chrome, Firefox and Ultimate. |
| Managed launch | Use one native browser process tree and one new user-data directory per Ultimate profile. Ultimate starts the pinned browser with a versioned local launch contract. Require the runtime to acknowledge the applied policy before any ordinary navigation. Pass proxy credentials over a private local channel and exclude them from command-line arguments and diagnostics. |
| Proxy identity | Reuse Ultimate's proxy resolver and encrypted MaxMind settings. Native Chromium must observe the same exit through its network service before enabling navigation. Apply timezone before renderer and worker startup. Feed approximate coordinates and provider accuracy through Chromium's geolocation permission path. Suspend browsing on verification loss or reassignment, then require a fresh verified identity. |
| Observable policy | Keep the UA, Client Hints and capabilities tied to the build. Apply explicit language settings to network headers and renderer APIs. Use browser-supported WebRTC routing and permission controls. Evaluate API access restrictions for Canvas, AudioContext, WebGL and WebGPU against compatibility fixtures. Qualify frames, workers and session restore before exposing settings. |
| Automation | Use Chromium's normal launch for interactive sessions with no CDP port or pipe. Give authorized automation its own launch mode, authenticated manager-side lifecycle, a private child connection, and explicit teardown. |
| Data | Keep experimental, Chrome and Firefox data in their existing directories. First native launch creates separate data. Any transfer needs an explicit, separately tested import or migration with source preservation and a recovery path. |
| Extensions | Start with the upstream Chromium extension framework and verify supported Manifest V3 service workers, permissions, install/update and restart with concrete extensions. Distribution and store access need independent qualification. |
| Updates | Use the upstream updater as the candidate, with an Azwah application ID, update endpoint, signed packages, staged rollout and rollback policy. Maintain a small source patch series on a stable pin. For each upstream security update, rebase, rebuild, rerun qualification, then sign and promote. |

[Chromium Updater functional specification](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/updater/functional_spec.md)

## Promotion

Keep baseline outputs outside Ultimate packaging. A branded native build can become the default only after exact-installer acceptance on Windows 10 and Windows 11. The gate covers five simultaneous native browser profiles, real browsing and login persistence, extension lifecycle, independently verified two-region Auto Location, proxy loss and reassignment, DNS and WebRTC leak assessment, native identity consistency, and the Owner, Admin, Office and legacy migration regressions. Retain the source and toolchain pins, installer SHA-256, signing identity and platform results with the build.
