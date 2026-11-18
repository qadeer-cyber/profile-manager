# Latitude-oriented resource guards (local only)

These are **soft caps** on a single Windows/Linux machine (~8 GiB class). They do **not** reserve RAM for Chromium and they do **not** report fake GPU or HD 620 benchmark numbers.

| Setting | Default | Effect |
|---------|---------|--------|
| `maxRunningProfiles` | 4 | Refuses new launches when this many profiles are live (`429 TOO_MANY_PROFILES`). |
| `minFreeMemoryGiB` | 1 | Refuses launch when host free memory is below this guard (`503 LOW_MEMORY`). |
| `maxConcurrentLaunches` | 2 | Limits parallel startup work in `launch-queue.js` (not live browser count). |
| `launchReservationSeconds` | 120 | Queue reservation TTL for launch slots. |

Diagnostics → App panel and `GET /api/diagnostics` include `launchLimits` via `resourceLimitsSummary()`. Monitoring page shows running PIDs when the host exposes process RSS (Linux `ps` path).

**BLOCKED without owner hardware:** Latitude 5480 physical smoke, Intel HD 620 WebGL label verification, dual-engine concurrent benchmarks.
