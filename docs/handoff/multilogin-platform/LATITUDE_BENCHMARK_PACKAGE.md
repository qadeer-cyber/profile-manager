# Latitude benchmark package (prepare only — owner runs on hardware)

**Target hardware class:** Dell Latitude 5480 (i5-7300U, 8 GiB RAM, 1366×768, Intel HD 620)  
**Policy:** No invented scores or Multilogin parity percentages.

## Included in repo

| Artifact | Purpose |
|----------|---------|
| `scripts/latitude-resource-benchmark.mjs` | Template JSON + optional live `/api/dashboard` + `/api/resources` snapshot |
| `docs/handoff/multilogin-platform/LATITUDE_RESOURCE_GUARDS.md` | Default guards (4 profiles, 1 GiB free memory, 2 parallel launches) |
| Settings UI copy | Documents Latitude-oriented defaults |

## Owner procedure (not run by CI agent)

1. On physical Latitude (or equivalent), install branch build from `feature/dedicated-browser-engine` final candidate SHA.
2. Set disposable `PM_DATA_DIR`.
3. Export `PM_API_TOKEN`; start app; note loopback base URL from Diagnostics.
4. Run:
   ```bash
   PM_API_TOKEN=… node scripts/latitude-resource-benchmark.mjs --base http://127.0.0.1:<port>
   ```
5. Perform two cold/warm automation launches per script template; paste JSON output into `LATITUDE_RESOURCE_GUARDS.md` under **Owner evidence**.
6. Do **not** treat cloud-agent VM metrics as product targets.

## CI note

`engine-windows` on GHA validates tests and Firefox spawn; it is **not** Latitude hardware evidence.
