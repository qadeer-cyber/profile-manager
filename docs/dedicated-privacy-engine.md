# Azwah dedicated privacy engine feasibility

## Choice

Start with a dedicated, separately packaged Electron browser shell over upstream Chromium. It runs its own executable and browser process with a per-profile Chromium user-data directory and session directory. Existing Azwah launch plans mix native spawn, Playwright and browser-specific switches. The existing validated configuration and Issue #20 migration stay on the manager side. The prototype uses a small versioned profile config and a private in-process Chromium DevTools connection. It loads neither Chrome Stable nor Chrome for Testing.

A Chromium source fork is feasible but premature for capabilities Electron can already enforce. Native browser UX, broad extension compatibility and settings below Electron or CDP boundaries could justify a small downstream patch set later. Avoid a persistent fork of Blink, network routing or sandbox code without funded security ownership. Keep truthful platform, browser and GPU observations.

## Windows x64 source-build path

Pin an upstream stable Chromium tag, DEPS and depot_tools revision. Follow the instructions for that exact tag. Current upstream Windows build documentation calls for NTFS with at least 100 GB free, Visual Studio and Windows SDK versions specified by the checkout, depot_tools, GN and autoninja. Reserve a dedicated Windows x64 worker with substantial additional SSD headroom for symbols, separate builds and source caches. Bootstrap with fetch/gclient, generate a release x64 GN configuration, then build chrome and the upstream installer and test targets. Treat proprietary Chrome services, codecs, branding, update endpoints and extension-store privileges as separate compatibility and licensing questions.

- [Chromium Windows build instructions](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/windows_build_instructions.md)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron release support](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)
- [Electron extensions](https://www.electronjs.org/docs/latest/api/extensions)
- [Electron signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)

## Windows proof of concept

The workflow creates an unsigned, isolated NSIS QA installer using the locked Electron runtime. It installs to a runner-private directory, then runs the actual packaged browser executable against synthetic loopback fixtures. The application identifier and data directory are separate from all Azwah product editions. The job has read-only GitHub permissions and does not upload a release. Verify the result in the job log before assigning any VERIFIED status.

To run a development window after installing repository dependencies, create a UUID-named folder under `%APPDATA%\Azwah Privacy Prototype` and save `profile.json` inside it. Example values are `{"version":1,"timezone":"Asia/Tokyo","location":{"latitude":35.7,"longitude":139.7,"accuracy":50000},"geolocationOrigin":"https://example.com"}`. Invoke `node_modules\.bin\electron.cmd engine-prototype --azwah-profile=YOUR_UUID --azwah-url=https://example.com`. Only the exact configured top-level origin can access the saved location. Other permissions default to denied. The verify flag permits loopback HTTP and produces a fixed diagnostic report inside the fixture profile.

| Capability | Prototype scope |
|---|---|
| Executable and versions | Packaged path plus observed Electron and Chromium versions |
| Timezone and geolocation | IANA timezone and explicit coordinates with caller-provided accuracy, enforced through private CDP |
| Cookies, site storage, restart | Separate persistent stores, exercised on two synthetic profiles and a forced termination |
| Locale, browser and OS identity | Read-only navigator language and platform observations, no identity replacement |
| Proxy, DNS, WebRTC and proxy-derived location | Unsupported in the prototype. Integrate the manager's proxy and provider path and qualify real HTTP, HTTPS, DNS, WebRTC and outage behavior before offering the controls |
| Screen, WebGL, canvas and audio | Prototype has a normal window. Hardware readback observations and display tests are follow-up work. Synthetic readback behavior is unsupported |
| Fonts, media and site permissions | Deny-by-default permission policy. Camera denial is tested. Font and audio-device behavior need separate browser checks |
| Extensions and automation | Unsupported in the prototype. Electron supports only a subset of extension APIs. Test extension IDs, MV3 workers, content scripts, permissions, state persistence and updates before claiming compatibility |
| Migration | Product profile directories are out of scope for the prototype. Keep Issue #20 recovery upstream, then import a copy into a separate versioned store with explicit compatibility and rollback checks |

## Security and maintenance

The remote page has no preload, Node access or Electron IPC, and runs sandboxed with context isolation. HTTPS navigation is allowed, popups, webviews and downloads are blocked, and debugging uses the main process API with no network port. A production shell needs trusted address chrome, origin and TLS error UX, secure permission prompts, security review and browser-policy tests. The prototype is for synthetic QA only.

Track Chromium and Electron security releases continuously. Stay on a supported Electron line and rehearse updates and rollback with staged Windows runs. A source fork also needs emergency upstream cherry-picks, symbol retention, SBOMs, third-party notices and patch ownership. Sign Windows binaries and installer with an approved Authenticode identity in a controlled signing service, timestamp and independently verify signatures and hashes. Use signed update metadata, rollback protection, canary rings and data-version checks before any production distribution. Keep build, qualification and publishing separated. The existing Azwah updater and release policy are outside this proof of concept.

Next milestones are a trusted address bar, manager-owned per-profile policy handoff, controlled proxy and DNS qualification, supported extension matrix, and a copied legacy-data trial. Compare installed Windows results and measured maintenance cost before choosing whether to fork Chromium.
