# Ultimate 3 Track B — proxies and automation

Branch: `feature/ultimate3-automation-proxies`  
Baseline SHA: `09d25c46215113bdf33ad7718eea041c3e0adde3`  
Scope: M17, M18, M33, M35, M36, M37. Fingerprint rows M20–M30, custom engines, and M42 are out of scope.

## Dual metrics

These two numbers answer different questions. The track checklist does not replace the strict denominator.

| Metric | Question | This branch |
|--------|----------|-------------|
| Strict matrix | `(VERIFIED + 0.5 × PARTIAL) / 43` on `MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md` | Locked baseline **18 V / 20 P / 5 U / 2 NA = 65.1%**. After M35 and M36 promotions: **20 V / 18 P / 5 U / 2 NA = 67.4%** (+2.3 points). |
| Track checklist | Did the acceptance contract for each Track B id pass on this Linux host? | M17, M18, M33, M37 stay **PARTIAL** with the gaps named in their contracts. M35 and M36 are **VERIFIED** by the tests named below. |

No second percentage is published for the six-id checklist.

## Acceptance

| ID | Status | Contract |
|----|--------|----------|
| M17 | PARTIAL | [M17-acceptance.md](M17-acceptance.md) |
| M18 | PARTIAL | [M18-acceptance.md](M18-acceptance.md) |
| M33 | PARTIAL | [M33-acceptance.md](M33-acceptance.md) |
| M35 | VERIFIED | [M35-acceptance.md](M35-acceptance.md) |
| M36 | VERIFIED | [M36-acceptance.md](M36-acceptance.md) |
| M37 | PARTIAL | [M37-acceptance.md](M37-acceptance.md) |

## Security

- Provider fixture files use obvious fake secrets. Responses drop password, token, and api-key fields. The live opt-in reads tokens from the environment and is skipped unless `PM_PROVIDER_LIVE=1`.
- The metering proxy accepts loopback HTTP only and refuses URLs with userinfo.
- `pm-cli exec` spawns `node` with `shell: false`. The API token is not placed on the script argv.
- Human input is authorized local UI testing. It is not a CAPTCHA or access-control bypass. M42 stays UNSUPPORTED.
- Profile encryption, secret storage, and the experimental Ultimate 2 release path were not changed.

## Windows

Windows paid runners and Dell hardware were not used. Owner Windows qualification remains blocked on `#4931951`. Nothing in this track claims a Windows pass.
