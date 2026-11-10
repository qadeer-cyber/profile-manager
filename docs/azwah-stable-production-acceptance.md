# Azwah Ultimate Stable Chrome production acceptance

The Stable edition uses the externally installed Google-signed Chrome executable. This checklist tracks release evidence. Record the installer commit and EXE hash, Windows edition and build, Chrome version, and date for every result. Keep credentials, unredacted endpoint logs, and personal profile data out of GitHub.

## Browser capability audit

Multilogin's [published fingerprint controls](https://multilogin.com/help/profile-settings-fingerprint-section) describe coordinated settings across timezone, location, language, screen, fonts, media devices, Navigator, graphics, canvas, audio, and WebRTC. Those controls describe the vendor's product. The table below records the boundaries of Azwah's Stable edition.

| Area | Azwah Stable behavior | Production evidence |
| --- | --- | --- |
| Profiles and sessions | Dedicated user-data directories, independent Chrome processes, and settings-only UI duplication | Two real Chrome profiles previously passed cookie, storage, service-worker, and relaunch isolation. Existing-install upgrade and crash recovery still need client evidence. |
| Timezone and geolocation | Chrome emulation through a private debugging pipe. Automatic launch verifies exit IP and checks page timezone and permitted location before opening requested URLs. | Manual settings and DST samples passed in real Chrome. Two regional authenticated proxies and live rotation are required. Workers and cross-origin frames need separate coverage. |
| Languages and locale | Chromium preferences and launch settings, with managed locale support | Compare navigator language order, Intl locale, and HTTP Accept-Language on a controlled endpoint. |
| User agent, Navigator, client hints | Stock defaults. Explicit UA presets derive from the detected browser version. Presets use overrides and can diverge across targets. | Check default and any supported preset after a Chrome update. No arbitrary hardware or device identity guarantee. |
| Screen, fonts, media devices | Window placement, screen or scale settings where supported, and local-font, camera and microphone permission restrictions | Check observed dimensions, DPR, permissions and browser defaults. Permission denial does not replace font rendering or hardware identity. |
| Canvas, audio, WebGL, WebGPU | Stock canvas/audio/GPU behavior by default. Experimental page readback hooks and supported graphics restrictions are separate settings. | No release claim for engine-wide spoofing, coherent GPU replacement, or AudioContext noise. |
| Network and WebRTC | Explicit proxy, authenticated relay, no configured direct fallback, disabled QUIC and DNS prefetch, destination host resolver rules, and restricted non-proxied WebRTC UDP | Controlled DNS, ICE, IPv4/IPv6, HTTP(S), WSS, outage and rotation tests still required. Resolver rules apply within Chromium and are not a host firewall. |
| Automation | Page emulation uses a private pipe. Explicit automation options can change browser-observable behavior. | No invisibility guarantee. Engine-wide consistency would require a separately qualified engine or OS-level network enforcement. |

## GeoIP source

The implementation uses [MaxMind City web services](https://dev.maxmind.com/geoip/docs/web-services/). Enter your own account and license key locally. The service returns approximate coordinates and an accuracy radius. It cannot establish a street address or prove a proxy's physical location. GeoLite City is a possible lower-cost alternative with separate service terms, quotas and credentials. It has not been integrated or qualified. No GeoIP database is redistributed by this build.

## Regional proxy acceptance on a Windows client

1. Use a trusted checkout of the commit under test, Windows x64, Node 22 and signed Chrome Stable. Run `npm ci` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in that shell.
2. From the repository root run `pwsh -NoProfile -File scripts/test-stable-regional-proxies.ps1`. Use two authorized authenticated HTTP, HTTPS, or SOCKS5 proxies with independently known public exits and different IANA timezones. The script prompts for credentials, sends them over standard input, and uses a disposable Azwah store. It checks IP, timezone, DST samples, browser geolocation verification, distinct PIDs, new tabs, navigation, and relaunch.
3. Test live rotation separately with a provider whose exit you can intentionally change. In the installed client, record the old and independently expected new exit. Confirm Azwah invalidates the old verification, revalidates on relaunch, or stops if verification fails. Break the upstream connection while loading a controlled endpoint and confirm the endpoint sees no request from the host public IP. Test unauthenticated and rejected credentials separately.
4. Use a DNS zone and HTTPS/WSS endpoint you control, plus a STUN endpoint and a local packet capture. Use fresh unique DNS names and test A-only and AAAA-only endpoints and WSS upgrades. Compare authoritative DNS logs, server peer addresses, and ICE candidates with the expected proxy path. Test Secure DNS on and off, and capture browser background traffic during launch and proxy outage. Any unexpected host DNS, host public IP, or non-proxied UDP is a failure requiring investigation. Browser output alone is insufficient to prove absence of leaks.
5. Record cross-origin frames, dedicated and shared workers, and service workers separately. Record unsupported or inconsistent targets explicitly. Test Windows 10 on the Dell and Windows 11 on a separate client. Measure concurrent profile memory on the 8 GB Dell, verify upgrades from the previous installed version, run backup/restore and role checks, and verify uninstall retains user data.

Windows Server smoke tests, fixture results, and a published CI artifact do not close these client and real-network gates. Final publication requires all mandatory evidence and owner approval.
