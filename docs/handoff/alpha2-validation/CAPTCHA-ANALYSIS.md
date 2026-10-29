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
