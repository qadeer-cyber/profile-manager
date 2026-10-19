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
| Screen, fonts, Navigator, WebGL, canvas, audio | Listed in the fingerprint section as profile settings. [Fingerprint settings](https://multilogin.com/help/en_US/profile-settings-fingerprint-section) | Not set. Stock Chromium plus Playwright's default switches. |
| Cookie import and export | Launcher cookie endpoints. [Cookie export](https://multilogin.com/help/en_US/how-to-export-cookies-using-api) | Cookies live in the profile directory. There is no import/export API. |
| Start and stop from an API, plus Playwright, Puppeteer, and Selenium | Automation FAQ lists those tools and start/stop. [Automation FAQ](https://multilogin.com/help/en_US/getting-started-with-multilogin-x-automation/automation-faq). API index: [Postman collection](https://documenter.getpostman.com/view/28533318/2s946h9Cv9) | Local `/api/v1` can launch and stop. CDP is returned only when automation is explicitly on. Example scripts are in `examples/`. |
| Team workspaces, folders, and cloud phones | Account roles and Android cloud phones are separate products in the same help center. [Proxy settings](https://multilogin.com/help/en_US/profile-settings-proxy-section) | Local single-user app. Profiles have a folder string. No cloud phones. |

## Roadmap

Each milestone is small enough to land on `development/v0.5.0` without a release. Do not merge to `main` from these milestones.

### M1. Lifecycle (this branch)

Acceptance tests, in `test/lifecycle.e2e.js` unless noted:

- Closing one tab while another page is open leaves the profile running.
- A graceful browser quit (the headed window Close button; `Browser.close` in the headless test) leaves Stopped, with `last_error` null, the process gone, and `.pm-lock` gone. The same holds for an authenticated SOCKS5 profile.
- App Stop does the same and keeps a cookie and localStorage for the next launch.
- A forced kill sets `last_error`, emits `profile:crashed`, and releases the lock. The lifecycle test uses `taskkill /F` on Windows and `SIGKILL` elsewhere. The existing engine suite still asserts `/unexpectedly|died/`.
- A successful relaunch clears `last_error`.
- IPC `stopServer` still persists the cookie and localStorage. The existing engine suite's safe-shutdown section must stay green.

### M2. Diagnostics page, observation only

Show, for the running profile, the values the browser is actually using. Do not add a control that tries to solve or avoid a challenge.

Acceptance tests:

- The diagnostics payload includes the Chromium version, the user-agent string, timezone, locale, and whether a proxy is configured.
- It reports that no WebRTC IP-handling policy was passed, until a later milestone sets one.
- It does not include proxy passwords.

### M3. Proxy-aligned locale, timezone, and language

Acceptance tests: a profile with a recorded proxy country launches with that timezone and `Accept-Language`, and a profile without a proxy keeps the host values. A unit test rejects an unknown timezone id.

### M4. WebRTC policy

Acceptance tests: a proxied profile gets a single explicit WebRTC IP-handling policy flag, and a profile with no proxy does not. A manual check, not a unit test, compares the ICE candidates with the proxy IP. Disabling WebRTC entirely is a separate setting because it breaks calls.

### M5. Per-profile extensions

Playwright's default switches include `--disable-extensions`. Acceptance test: an extension listed on the profile is loaded, and a profile with none still launches. Do not bundle a store of extensions.

## Playwright and Electron now, versus a custom Chromium

What this process can set with the current Playwright launch, and can read back over CDP:

- Locale and `Accept-Language` (`locale` on the context).
- Timezone (`timezoneId`).
- Viewport and device scale factor.
- Geolocation permission and a fixed geolocation, only after the user grants the permission in the profile.
- A WebRTC IP-handling policy, as a Chromium switch. This is a policy flag, not a guarantee about every ICE candidate.
- An unpacked extension, once `--disable-extensions` is not applied to that launch.

The font list the browser reports is the host operating system's. This note does not choose a way to replace it.

### Canvas, WebGL, audio, and client hints (research only)

These four are not implemented. Mohammad has not decided where the boundary is, so this section only describes them. Do not add a setting, a launch flag, or a CDP override for them until that decision exists.

- Canvas. A page can read back pixels from a canvas. Profiles in other products expose this as a setting. No method is chosen here.
- WebGL. A page can read the renderer and vendor strings, and pixels from a WebGL canvas. Same status as canvas.
- Audio. `AudioContext` output can differ from one machine to another. No processing change is proposed.
- Client hints. Chromium sends `Sec-CH-UA` and related hints alongside the user-agent. Playwright can call `Emulation.setUserAgentOverride`, which also covers those hints. This app does not call it, and this note does not decide that it should.

A custom Chromium would mean rebasing every security update, rebuilding for Windows, and running the offline installer again. The unsigned NSIS package is already about 354 MB with stock Chromium 156. That cost is context for the boundary decision above. It is not a decision to fork, and it is not a decision to ship these controls on stock Chromium.

## What the launched browser sends today

Confirmed from `server/browsers.js`, Playwright's Chromium switches in the installed `playwright-core`, and the build 30 command line:

- No `userAgent`, `locale`, `timezoneId`, `geolocation`, or viewport override. `viewport` is `null`, so the window is not emulated.
- Playwright adds `--remote-debugging-pipe` on every launch. This app adds `--remote-debugging-port` only when automation is on.
- Playwright's current default switch list does not include `--enable-automation`. The build 30 command line did not include it either. Whether `navigator.webdriver` is still true because of the pipe was not measured.
- `--disable-extensions` is in those defaults, so extensions are off.
- An authenticated SOCKS5 proxy is given to Chromium as a local HTTP relay. Playwright's SOCKS-only `--host-resolver-rules` therefore do not apply. HTTP and HTTPS hostnames are resolved by that proxy.
- Playwright adds one `--proxy-bypass-list=<-loopback>` when a proxy is set and the bypass list does not already mention loopback. Loopback then goes through the proxy.
- No WebRTC IP-handling switch is present. WebRTC UDP is not carried by the HTTP relay. Whether a page can see the host address that way was not measured in this tree.
