# Profile config engine

**Module:** `server/profile-config-engine.js`

- Merges `browserSettings`, `webrtcSettings`, `advancedSettings`, `browserEngine`.
- JSON Schema export: `GET /api/profile-config/schema`
- Validate + warnings: `POST /api/profile-config/validate`
- Per-profile: `GET /api/profiles/:id/browser-config` (existing)

Tests: `test/profile-config-engine.test.js`
