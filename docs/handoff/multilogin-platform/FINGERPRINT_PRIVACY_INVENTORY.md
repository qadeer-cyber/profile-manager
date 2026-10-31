# Fingerprint & privacy inventory (A–F)

Source of truth: `server/privacy-engine-report.js` + `server/browser-runtime/capability-matrix.js`.

| Area | Real control | Status |
|------|--------------|--------|
| A Identity / UA | Presets from CfT version | PARTIAL |
| B Locale / TZ / lang | CLI + prefs | PARTIAL |
| C Screen / DPR | Window flags | PARTIAL |
| D WebRTC | Policy flags | VERIFIED |
| E WebGL / WebGPU | Disable WebGL only | PARTIAL / UNSUPPORTED |
| F Canvas / Audio noise | — | UNSUPPORTED |

Diagnostics-only items are labeled in API reports, not as implemented controls.
