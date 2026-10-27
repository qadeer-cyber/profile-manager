# Proxy Library API (v1 draft, stable for UI mocking)

Status: **implemented** on branch `lead/proxy-library`. The spec was committed first, in its own commit, so UI work could mock against it. The implementation follows it; the notes below record what was settled during implementation.
Every endpoint exists in two places:
- `/api/...` is the UI API. In the desktop app it requires the `X-UI-Token` header.
- `/api/v1/...` is the automation API. It requires `Authorization: Bearer <token>` or `X-API-Key`.

**Passwords are never returned.** Responses only include `hasPassword: boolean`.

## Data model (DB migration v6)

```sql
CREATE TABLE proxies (
  id                   TEXT PRIMARY KEY,                       -- uuid
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('http','https','socks5')),
  host                 TEXT NOT NULL,
  port                 INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  username             TEXT NOT NULL DEFAULT '',
  password             TEXT NOT NULL DEFAULT '',               -- encrypted: 'ss:v1:…' (safeStorage) or 'enc:v1:…' (AES-GCM)
  tags                 TEXT NOT NULL DEFAULT '[]',             -- JSON array of strings
  last_test_status     TEXT CHECK (last_test_status IN ('ok','failed')),
  last_test_ip         TEXT,
  last_test_latency_ms INTEGER,
  last_test_error      TEXT,                                   -- error code, see below
  last_tested_at       TEXT,                                   -- ISO 8601
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
ALTER TABLE profiles ADD COLUMN proxy_id TEXT REFERENCES proxies(id) ON DELETE SET NULL;
```

Migrating existing data:
- Every profile that has an inline proxy (the old `profiles.proxy` JSON) gets a library row, linked through `proxy_id`.
- Profiles with identical `type`, `host`, `port`, `username` and stored password share one row.
- The stored ciphertext is copied unchanged, so no decryption happens during the migration. The inline column is then cleared.
- New rows are named `"<type>://<host>:<port>"`.

`type` meanings, as used by Chromium:
- `http`: plain HTTP proxy.
- `https`: TLS connection to the proxy itself.
- `socks5`: SOCKS5. A username and password are supported through the app's local relay.

## Proxy object (response)

```json
{
  "id": "6f1c2a8e-3a4b-4c1d-9e7f-1a2b3c4d5e6f",
  "name": "US residential 1",
  "type": "socks5",
  "host": "198.51.100.20",
  "port": 1080,
  "username": "alice",
  "hasPassword": true,
  "tags": ["us", "residential"],
  "lastTest": {
    "status": "ok",                 // "ok" | "failed" | null (never tested)
    "ip": "203.0.113.7",            // external IP seen through the proxy (null if failed)
    "latencyMs": 412,
    "error": null,                  // error code when failed
    "testedAt": "2026-10-18T14:05:00.000Z"
  },
  "assignedProfiles": 2,            // number of profiles using this proxy
  "createdAt": "2026-10-18T14:00:00.000Z",
  "updatedAt": "2026-10-18T14:00:00.000Z"
}
```

## Error responses
Every error is JSON: `{ "error": "human readable message", "code"?: "MACHINE_CODE", ... }`. Status codes:
- `400`: validation failed.
- `401`: auth missing or wrong.
- `404`: unknown id.
- `409`: conflict, such as deleting a proxy that is still assigned.

## Endpoints

### `GET /api/proxies`
Query (all optional):
- `q`: substring match on name, host, username and tags.
- `tag`: exact tag.
- `status`: `ok`, `failed` or `untested`.

Returns `Proxy[]`, newest first.

### `POST /api/proxies`
```json
{ "name": "US 1", "type": "http", "host": "proxy.example.com", "port": 8080,
  "username": "bob", "password": "s3cret", "tags": ["us"] }
```
- `name` is optional and defaults to `"<type>://<host>:<port>"`.
- `username`, `password` and `tags` are optional.
- `type` must be `http`, `https` or `socks5`.
- `port` must be 1–65535.
- `host` must be a hostname, IPv4 address or bracketed IPv6 address.

Returns `201 Proxy`.

### `GET /api/proxies/:id`
Returns `200 Proxy`, or `404`.

### `PATCH /api/proxies/:id`
- Send any subset of `name, type, host, port, username, password, tags`.
- `password: ""` clears the password. Leaving `password` out keeps it unchanged.
- Changing `type`, `host`, `port`, `username` or `password` resets `lastTest` to never tested.
- Profiles that are currently running keep the old settings until their next launch.

Returns `200 Proxy`.

### `DELETE /api/proxies/:id[?force=1]`
- If no profile uses the proxy: returns `204`.
- If profiles use it and `force` isn't set: returns `409`.
  ```json
  { "error": "Proxy is assigned to 2 profile(s). Unassign it first or pass ?force=1.",
    "code": "PROXY_IN_USE", "assignedProfiles": [{ "id": "…", "name": "Work" }] }
  ```
- With `?force=1`: those profiles are unassigned (`proxy_id = NULL`), then the proxy is deleted. Returns `204`.

### `POST /api/proxies/:id/test`
- Makes a real request through the proxy to an IP-echo service. The default is `https://api.ipify.org?format=json`; `PROXY_TEST_URL` overrides it.
- The timeout defaults to 10 s; `PM_PROXY_TEST_TIMEOUT_MS` overrides it.
- The result is saved to `last_test_*`.

```json
// success
{ "ok": true, "ip": "203.0.113.7", "latencyMs": 412, "error": null, "message": null, "proxy": { …Proxy } }
// failure
{ "ok": false, "ip": null, "latencyMs": 10003, "error": "timeout", "message": "No response from proxy within 10000 ms", "proxy": { …Proxy } }
```

| `error` code | Meaning |
|---|---|
| `auth_failed` | Proxy rejected the credentials (HTTP 407, SOCKS5 auth failure) or requires credentials that weren't supplied |
| `connect_refused` | TCP connection to the proxy refused (`ECONNREFUSED`) |
| `timeout` | No answer in time (connecting or waiting for the response) |
| `dns` | Proxy hostname couldn't be resolved (`ENOTFOUND`, `EAI_AGAIN`) |
| `protocol_unsupported` | The server doesn't speak the configured protocol, for example `socks5` pointed at an HTTP proxy or `https` pointed at a plain one |
| `unknown` | Anything else; `message` has the details |

The HTTP status is always `200` for a completed test. Check `ok`.

### `POST /api/proxies/import`
```json
{ "text": "1.2.3.4:8080\nproxy.example.com:3128:bob:pw\nsocks5://alice:s3cret@10.0.0.5:1080\n# comment\n",
  "defaultType": "http", "tags": ["batch-1"] }
```
Accepted line formats:
- `host:port`
- `host:port:user:pass`
- `scheme://host:port`
- `scheme://user:pass@host:port`

Rules:
- Blank lines and lines starting with `#` are skipped.
- `scheme` is `http`, `https`, `socks5` or `socks5h`; `socks5h` is treated as `socks5`.
- Lines with no scheme use `defaultType`, which defaults to `http`.
- In URLs, the username and password are URL-decoded.
- At most 1000 lines.
- An existing proxy with the same `type`, `host`, `port` and `username` counts as a duplicate and isn't created again.

Response `200`:
```json
{ "created": 2, "duplicates": 0, "failed": 1,
  "results": [
    { "line": 1, "input": "1.2.3.4:8080", "ok": true, "id": "…", "duplicate": false },
    { "line": 2, "input": "proxy.example.com:3128:bob:***", "ok": true, "id": "…", "duplicate": false },
    { "line": 3, "input": "bad line", "ok": false, "error": "Unrecognized format" }
  ] }
```
In `input`, the password is always masked as `***`.

### `POST /api/profiles/:id/proxy`
```json
{ "proxyId": "6f1c2a8e-…" }    // assign
{ "proxyId": null }            // unassign (direct connection)
```
Returns `200 Profile`. `404` means the profile or the proxy wasn't found. If the profile is running, the response also has `"appliesOnNextLaunch": true`.

### Profile object changes
Profiles now include:
- `proxyId`: string or null.
- `proxy`: `null`, or a summary `{ id, name, type, host, port, username, hasPassword, password: "••••" | "" }`. The `password` field is a fixed mask kept for the existing editor, never the real password.

For backward compatibility, `POST`/`PUT /api/profiles` still accept an inline `proxy: {type, host, port, username?, password?}`. The server reuses a matching library entry (same `type`, `host`, `port`, `username` and password) or creates a new one, then assigns it. `proxy: null` unassigns.

## Examples (curl)
```bash
T="Authorization: Bearer $PM_API_TOKEN"; B=http://127.0.0.1:3000/api/v1
curl -s -X POST $B/proxies -H "$T" -H 'Content-Type: application/json' \
  -d '{"name":"US 1","type":"socks5","host":"198.51.100.20","port":1080,"username":"alice","password":"s3cret","tags":["us"]}'
curl -s $B/proxies?status=untested -H "$T"
curl -s -X POST $B/proxies/<id>/test -H "$T"
curl -s -X POST $B/proxies/import -H "$T" -H 'Content-Type: application/json' -d '{"text":"1.2.3.4:8080\nsocks5://u:p@5.6.7.8:1080"}'
curl -s -X POST $B/profiles/<profileId>/proxy -H "$T" -H 'Content-Type: application/json' -d '{"proxyId":"<id>"}'
curl -s -X DELETE "$B/proxies/<id>?force=1" -H "$T"
```

## Implementation notes
- Legacy endpoints are kept. `POST /api/proxy/test` (ad-hoc inline proxy, not saved) and `POST /api/profiles/:id/test-proxy` now return the same `{ok, ip, latencyMs, error, message}` shape as the library test.
- `dns`: the proxy host is resolved before connecting, so resolver failures are reported as `dns` and not as `timeout`.
- `https` proxies are tested over TLS to the proxy. Set `PM_PROXY_TEST_INSECURE_TLS=1` to accept self-signed proxy certificates.
- `auth_failed` also covers a SOCKS5 server that accepts none of the offered auth methods, meaning it requires credentials that weren't given.
