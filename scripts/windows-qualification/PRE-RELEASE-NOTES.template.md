# Ultimate 2.0 unified — Windows offline pre-release (RC)

**Status:** Pre-release candidate — **unsigned** Windows installer unless otherwise noted.

## Source

| Field | Value |
|-------|--------|
| Repository | qadeer-cyber/profile-manager |
| Branch | integration/ultimate2-unified-pr |
| Commit | {{FULL_SHA}} |
| RC tag | {{RC_TAG}} |

## Windows qualification

- Real M8 acceptance: Chromium + Firefox — **{{M8_SUMMARY}}**
- Offline NSIS x64 built on **windows-2022** (or owner-qualified Windows host)
- Core regression suites: see `BUILD-MANIFEST.txt` / build transcript

## Install

1. Download `{{EXE_NAME}}` and verify against `SHA256SUMS.txt`.
2. SmartScreen may warn (unsigned binary).
3. Per-user install; offline bundle includes pinned Chromium.

## Not included

- Not a merge to `main`.
- Not a production/stable release.
- **Alpha.3** builds are used only for upgrade-smoke baselines, not as this Ultimate 2.0 artifact.

## Known limitations

- Strict unified matrix remains ~65.1% VERIFIED/PARTIAL mix; Grok ~80.2% is a separate scorecard.
- Canvas/WebGL hooks: opt-in experimental page scripts, not custom engines.
- CAPTCHA-free guarantee: unsupported.

## Verification

```
SHA256 {{SHA256}}
Bytes {{BYTES}}
```

Generated: {{UTC_TIMESTAMP}}
