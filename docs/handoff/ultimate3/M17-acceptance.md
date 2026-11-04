# M17 — Proxy templates, traffic controls, measured savings

**Status: PARTIAL**

## What passed

- A proxy template stores `{ enabled, blockExtensions }` and instantiate copies that policy onto the live proxy.
- `POST /api/v1/proxies/traffic/measure` sends the script’s loopback HTTP URLs through a local metering proxy.
- `originResponseBytes` counts origin **response body** bytes actually read.
- A blocked extension never opens an origin connection. The fixture image hit counter stays unchanged.
- `GET /api/v1/proxies/traffic/savings` returns `savingsBytes = baseline.originResponseBytes - controlled.originResponseBytes` only when both sessions share `scriptId`, attempted the same number of requests, the baseline policy is disabled, and the controlled session blocked at least one request.
- Mismatched sessions return `savingsBytes: null`. `invented` is false. `trafficSaverSupported` stays false.

Test: `test/proxy-traffic.test.js`.

## Gap (why not VERIFIED)

- HTTPS `CONNECT` tunnels do not expose the URL path, so extension blocks are not applied to TLS traffic and no byte savings are claimed for them (`httpsConnectBlocking: false`).
- Profile launch does not insert this meter in front of a library proxy. The control is an explicit measurement API, not an always-on browser traffic saver.
