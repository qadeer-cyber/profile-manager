# v0.5.0 research

Facts about this repository are from the tree on `development/v0.5.0`. Multilogin items are only what their public docs describe, with the URL for each. This is not a claim that either product is undetectable.

## Feature gap

| Capability | Multilogin public docs | This repository |
|---|---|---|
| Isolated browser profiles | Profiles keep their own browser data. [Browser profiles](https://multilogin.com/help/en_US/browser-profiles) | One Chromium user-data directory per profile under the app data `profiles/<id>` directory. Covered by the engine isolation tests. |
| HTTP, HTTPS, and SOCKS5 proxies, including a username | Custom proxy types and `IP:port:login:password`. [Proxy settings](https://multilogin.com/help/en_US/profile-settings-proxy-section), [custom proxies](https://multilogin.com/help/en_US/http-and-socks-proxies) | Same three types. A username is sent through a local no-auth relay (`server/browsers.js`). Passwords are encrypted. The proxy library tests cover this. |
| Built-in residential, mobile, or ISP proxies | "Multilogin" proxy choice, locations, and rotation. [Proxy settings](https://multilogin.com/help/en_US/profile-settings-proxy-section) | Not implemented. The user supplies the proxy. |
| Proxy check against the exit IP | "Proxy check passed" fetches IP-dependent data. [Custom proxies](https://multilogin.com/help/en_US/http-and-socks-proxies) | `POST /api/proxies/:id/test` records status, IP, latency, and a classified error. Covered by the proxy library tests. |
| WebRTC IP aligned with the proxy, or WebRTC disabled | Masked, Custom, Real, or Disabled. [Fingerprint settings](https://multilogin.com/help/en_US/profile-settings-fingerprint-section) | No WebRTC policy is set. See the launch notes below. |
| Timezone, languages, and geolocation aligned with the proxy | Masked timezone and the same fingerprint section's language and geolocation controls. [Fingerprint settings](https://multilogin.com/help/en_US/profile-settings-fingerprint-section) | Not set. The browser uses the host timezone and locale. |
| Screen, fonts, Navigator, WebGL, canvas, audio | Listed in the fingerprint section as profile settings. [Fingerprint settings](https://multilogin.com/help/en_US/profile-settings-fingerprint-section) | Not set. Design only, in the fingerprint section below. No spoofing code. |
| Cookie import and export | Launcher cookie endpoints. [Cookie export](https://multilogin.com/help/en_US/how-to-export-cookies-using-api) | Cookies live in the profile directory. There is no import/export API. |
| Start and stop from an API, plus Playwright, Puppeteer, and Selenium | Automation FAQ lists those tools and start/stop. [Automation FAQ](https://multilogin.com/help/en_US/getting-started-with-multilogin-x-automation/automation-faq). API index: [Postman collection](https://documenter.getpostman.com/view/28533318/2s946h9Cv9) | Local `/api/v1` can launch and stop. CDP is returned only when automation is explicitly on. Example scripts are in `examples/`. |
| Team workspaces, folders, and cloud phones | Account roles and Android cloud phones are separate products in the same help center. [Proxy settings](https://multilogin.com/help/en_US/profile-settings-proxy-section) | Local single-user app. Profiles have a folder string. No cloud phones. |

## Roadmap

Each milestone is small enough to land on `development/v0.5.0` without a release. Do not merge to `main` from these milestones.

### M1. Lifecycle (this branch)

Acceptance tests, in `test/lifecycle.e2e.js` unless noted:

- Closing one tab while another page is open leaves the profile running.
- A graceful browser quit (the window Close button, reproduced with `Browser.close`) leaves Stopped, with `last_error` null, the process gone, and `.pm-lock` gone. The same holds for an authenticated SOCKS5 profile. The suite launches the full browser so Preferences is written. A missing `exit_type` is not a crash on its own: exit code 0 is Stopped, and an unknown exit code stays Stopped unless Preferences says `Crashed`.
- App Stop does the same and keeps a cookie and localStorage for the next launch.
- A forced kill sets `last_error`, emits `profile:crashed`, and releases the lock. The lifecycle test uses `taskkill /F` on Windows and `SIGKILL` elsewhere. The existing engine suite still asserts `/unexpectedly|died/`.
- `profile.exit_type` of `SessionEnded` is Stopped. The test writes that value after the pid is dead, because CI cannot log the machine off.
- A successful relaunch clears `last_error`.
- IPC `stopServer` still persists the cookie and localStorage. The existing engine suite's safe-shutdown section must stay green.

### M2. Diagnostics page, observation only

Show, for the running profile, the values the browser is actually using. Do not add a control that tries to solve or avoid a challenge.

Acceptance tests:

- The diagnostics payload includes the Chromium version, the user-agent string, timezone, locale, and whether a proxy is configured.
- It reports that no WebRTC IP-handling policy was passed. The fingerprint design below is not a license to add one.
- It does not include proxy passwords.

### Fingerprint controls

Design only. Do not implement them, and do not add spoofing or evasion code. The notes are in the next section.

## Fingerprint design

Research and design only. Nothing in this section is implemented. It does not add a launch flag, a CDP override, or a profile setting, and it does not describe how to evade a site check.

A custom Chromium means rebasing each security update, rebuilding for Windows, and running the offline installer again. The unsigned NSIS package is already about 354 MB with stock Chromium 156. That cost is part of the complexity notes below.

### Browser version consistency

Playwright now, by not overriding anything. The running binary is the pinned Chrome for Testing build in `server/chromium-manifest.json` (156.0.8078.4 on this branch). The user-agent string then matches that binary. Shipping a different binary is a new pin or a fork, not a Playwright flag. Setting a user-agent that names some other version is possible and is out of scope, because the binary would still be the pin.

Privacy and security: the honest version gets the fixes that come with the next pin. A reported version that is not the binary is a lie. An old pin is the security risk.

Complexity: staying on one pin is the release process this repo already has. A fork is a new build pipeline.

How to test: over CDP, `Browser.getVersion` and the executable's version both equal the manifest. The launch command line contains no user-agent override.

### User-agent and client hints

Playwright now. The context `userAgent` option and CDP `Emulation.setUserAgentOverride` can set the user-agent and the client-hint metadata (`Sec-CH-UA` and related hints). This app does not call either.

Privacy and security: the default hints identify this Chromium build. Changing them changes what a page and an intercepting proxy record. A hint set that disagrees with the binary is detectable and is not a goal here.

Complexity: one CDP call is small. Keeping the hints, the user-agent, and the binary in agreement on every Chromium upgrade is the larger part.

How to test: a local page reads `navigator.userAgent`, and a local echo records `Sec-CH-UA`. With no override they match the pinned binary. A future setting, if one is ever approved, would be compared to that setting on the same local page. Do not point the test at a third-party detector.

### Timezone

Playwright now. `timezoneId` on the context is an IANA name. This app does not set it, so the browser uses the host zone.

Privacy and security: the host zone next to a proxy address in another country tells a page two locations. Setting a zone does not move the IP. A wrong zone breaks clocks and any check that cares about skew. It is not a security control.

Complexity: low for a known IANA name. Choosing that name from a proxy address needs a geo database this repo does not have.

How to test: a page reads `Intl.DateTimeFormat().resolvedOptions().timeZone`. If a setting exists, it equals that id. If it does not, it equals the host zone.

### Locale

Playwright now. The context `locale` option sets `Accept-Language` and `navigator.languages`. This app does not set it.

Privacy and security: the host locale beside a foreign proxy is the same kind of leak as the timezone. It does not hide the IP.

Complexity: low.

How to test: a page reads `navigator.language`, and a local echo records `Accept-Language`. Same shape as the timezone test: the setting when present, the host value when absent.

### Geolocation

Playwright now. A context can carry a fixed `geolocation`, and the page can read it only after the permission is granted. This app does not set one. The IP does not move.

Privacy and security: a granted position can disagree with the IP, and the page can see both. Geolocation is a permission. Granting it without a user action would be a new behavior. This note does not add a control that pretends the machine is somewhere else.

Complexity: low for a fixed coordinate after an explicit grant. The permission prompt is the part that needs a product decision.

How to test: after an explicit grant, `watchPosition` returns the configured coordinates. Without a grant, the page is denied. Do not assert anything about the IP.

### WebRTC privacy

Playwright now, as one Chromium policy flag (`WebRtcIPHandlingPolicy` values such as `disable_non_proxied_udp`), passed as a launch argument. It is not a guarantee about every ICE candidate. Authenticated SOCKS in this app is a local HTTP relay, and that relay does not carry WebRTC UDP. No policy is set today.

Privacy and security: without a policy, a page can gather a host candidate that is not the proxy address. Disabling WebRTC breaks calls. The flag is not an anonymity claim.

Complexity: low to pass a single flag. Checking the candidates is a manual look, not a unit test.

How to test: the command line contains one policy flag when a proxy is set, and none when it is not. A manual page compares ICE candidates with the proxy address. Do not treat that list as complete.

### Screen

Playwright now. `viewport` and `deviceScaleFactor`, and CDP `Emulation.setDeviceMetricsOverride`, can set the size the page sees. This app sets `viewport` to `null`, so the page sees the real window.

Privacy and security: screen size is one more value a page can store. Emulating a size that is not the window is a visible change. It does not hide the IP.

Complexity: low for a fixed viewport. Matching a real display, including the window chrome, is more than the viewport number.

How to test: `window.screen.width`, `window.screen.height`, and `window.innerWidth` over CDP. With no setting they match the host window. A future setting would match that setting.

### Canvas, WebGL, and audio

A custom Chromium. Playwright can read a canvas, the WebGL renderer strings, and an audio buffer. It cannot make those values stable across machines and still look like one real device. This app does not modify them. No noise and no spoofing.

Privacy and security: a page can use these surfaces to recognize a machine. Changing them is the work this section refuses to implement. A fork that patches them falls behind Chromium security updates.

Complexity: high. The cost is rebasing and shipping the fork, not the size of a single patch.

How to test: nothing until a design is accepted. A later test would be a local page that hashes a canvas, the WebGL renderer, and a short audio sample twice in one profile and once in another, against equality rules written in that design. Do not compare the result with an anti-bot vendor.

### Hardware info

Partly Playwright now, and not as a coherent set. CDP can override `navigator.hardwareConcurrency`. Memory and GPU values are a different surface, and they also show up through WebGL. This app sets none of them. A single override that disagrees with the GPU string is not a design we are adopting.

Privacy and security: core count and memory are fingerprint values. Overriding one of them while leaving the others is easier for a page to notice than leaving the host values alone.

Complexity: low for one override. High for a set that agrees with WebGL and the binary.

How to test: the negative test is that the launch arguments and the CDP session do not call a hardware override, and a page reads the host `navigator.hardwareConcurrency`. A positive test waits on an approved setting.

### Extension compatibility

Playwright now, for an unpacked extension. The default switches include `--disable-extensions`. Loading one means not applying that switch on that launch and passing the extension path. A store install and a component extension baked into a binary are not this. This app loads none.

Privacy and security: an extension can read pages and cookies. Loading one is a trust decision. An extension whose purpose is to spoof the surfaces above is out of scope.

Complexity: medium. The launch has to drop one default switch, load a path, and still start a profile that lists no extension.

How to test: a fixture unpacked extension sets a known value on a local page. A profile that lists it shows that value. A profile that lists none still launches and does not show it. Do not bundle a store of extensions.

## What the launched browser sends today

Confirmed from `server/browsers.js`, Playwright's Chromium switches in the installed `playwright-core`, and the build 30 command line:

- No `userAgent`, `locale`, `timezoneId`, `geolocation`, or viewport override. `viewport` is `null`, so the window is not emulated.
- Playwright adds `--remote-debugging-pipe` on every launch. This app adds `--remote-debugging-port` only when automation is on.
- Playwright's current default switch list does not include `--enable-automation`. The build 30 command line did not include it either. Whether `navigator.webdriver` is still true because of the pipe was not measured.
- `--disable-extensions` is in those defaults, so extensions are off.
- An authenticated SOCKS5 proxy is given to Chromium as a local HTTP relay. Playwright's SOCKS-only `--host-resolver-rules` therefore do not apply. HTTP and HTTPS hostnames are resolved by that proxy.
- Playwright adds one `--proxy-bypass-list=<-loopback>` when a proxy is set and the bypass list does not already mention loopback. Loopback then goes through the proxy.
- No WebRTC IP-handling switch is present. WebRTC UDP is not carried by the HTTP relay. Whether a page can see the host address that way was not measured in this tree.
