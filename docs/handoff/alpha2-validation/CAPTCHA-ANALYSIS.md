# Google Search CAPTCHA — alpha.2 investigation

Status: **investigation only**. No product change. This is not a bypass, and it is not a claim that a profile is undetectable or anonymous.

## What Windows already showed

On the installed alpha.2 EXE (`v0.5.0-alpha.2-m1-m9`):

- The installer launched.
- A profile was created and Chromium started.
- An authenticated SOCKS5 proxy test passed.
- The observed exit IP matched that proxy.
- Bing loaded.
- Google Search repeatedly showed a CAPTCHA.

Bing loading in the same session means navigation, DNS, and the proxy path were working. Google treated that session differently from Bing.

## What Linux could measure

Host: Linux, Node 22, pinned Chromium `156.0.8078.4` at Playwright revision 1248. No Google search was loaded. Nothing here tried to obtain a clean Google result.

Default profile launch (no custom user-agent, WebRTC mode `browser_default`, automation off):

| Check | Result |
|---|---|
| `--force-webrtc-ip-handling-policy` | absent |
| `--user-agent` | absent |
| `--remote-debugging-port` | absent |
| `--enable-automation` | absent |
| `--remote-debugging-pipe` | present (Playwright’s control channel) |
| `--disable-extensions` | present when the profile has no enabled extension |
| `--no-sandbox` | present (Playwright adds this unless sandboxing is turned on) |
| `navigator.webdriver` on the first page | `true` |
| `navigator.userAgent` | `Chrome/156.0.0.0` on Linux, which is Chromium’s own reduced string for this build, not a string this app composed |

The same binary started on its own, with only a user-data directory and `about:blank`, did not have the debugging pipe, `--disable-extensions`, or `--no-sandbox`. The app process had the Playwright switch set (about 40 arguments versus 4). Those switches come from Playwright’s Chromium launcher (`chromiumSwitches` in playwright-core 1.64.1), not from a fingerprint profile in this repository.

User-agent presets in this app are optional and default to “browser default,” which sets no UA flag. The reduced and full presets are built from the installed Chromium version. A free-form UA is rejected. WebRTC defaults to no policy flag. Extensions are loaded only when the profile assigns one; otherwise Playwright’s `--disable-extensions` stays.

## Conclusion

The CAPTCHA is **proxy reputation and client shape, not a broken Profile Manager page load**.

Google saw the proxy’s exit IP. The Windows check already showed that IP matched the SOCKS5 proxy, and Bing still loaded. Google Search is stricter about shared and datacenter addresses than Bing is. That difference, on a working browser, is an IP-reputation result.

The app also does not look like ordinary installed Google Chrome:

- The bundled browser is Chromium 156 (Chrome for Testing), not the Google Chrome brand.
- Playwright keeps a debugging pipe, so `navigator.webdriver` is true.
- With no extension assigned, extensions are disabled.
- This Linux launch included `--no-sandbox`.

Those are real differences. They can raise Google’s risk score. They are not a defect to close by hiding `navigator.webdriver`, swapping the user agent, or promising that a profile will pass Search. Doing that would be fingerprint masking. This pass does not do it.

## What a user can choose

These are optional and do not change the app:

- Use a residential proxy whose address is not shared across many sessions. A datacenter or crowded SOCKS endpoint is the first thing to change when Bing works and Google asks for a CAPTCHA.
- Keep fewer concurrent browsers on that same IP.
- Expect Google to keep challenging Chromium that is under Playwright control. That is a property of this architecture, not a Search outage.

No launch flag, WebRTC policy, or extension was changed for this finding.

## Troubleshooting workflow

This is a comparison procedure. It does not solve a challenge, patch the browser, or promise a CAPTCHA-free session. Google’s reputation score is not visible to this app, so a challenge after one of these steps is not proof of a single cause.

Use the same Windows machine for all four checks. A Linux result, including the SwiftShader WebGL string from the M10 fingerprint test, is not evidence for that machine.

1. **Normal Google Chrome, no proxy.** Open a fresh Chrome profile, not Profile Manager. Search on Google and open Bing. Record whether a challenge appeared, the Chrome version from `chrome://version`, and that `navigator.webdriver` is false in that window.
2. **Normal Google Chrome, the same proxy.** Configure that proxy only in Chrome. Repeat the same two sites. If the challenge appears here and did not appear in step 1, the exit address is enough to explain it. The proxy’s reputation is still unknown: a pass does not mean the address is “clean,” and a challenge does not name which signal Google used.
3. **Profile Manager, no proxy.** Launch one profile with automation off, WebRTC at browser default, no custom user agent, and no extension. Open the same two sites. Record the pinned Chromium version, whether the window is Chrome for Testing, and any error the app actually shows. Expect differences from step 1 even when the IP is the same: Playwright’s debugging pipe, `navigator.webdriver`, `--disable-extensions` when no extension is assigned, and `--no-sandbox` on the Linux launches that have been measured.
4. **Profile Manager, the same proxy.** Repeat step 3 with that proxy. Compare it with step 2 before blaming the profile. If Chrome-with-proxy is challenged and Profile Manager-with-proxy is challenged, the shared address is the common factor and the client differences in step 3 are extra, not a substitute explanation. If Chrome-with-proxy is not challenged and Profile Manager is, the client differences are the part this app can describe. They are not a defect to close by hiding `navigator.webdriver` or swapping the user agent.

Record failures as the text on screen or the app error. Do not translate a challenge into a claim that a fingerprint setting was detected. Fingerprint controls in this tree do not exist to get past this page.
