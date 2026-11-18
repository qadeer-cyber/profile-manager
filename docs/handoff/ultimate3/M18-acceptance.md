# M18 — Provider integration without committed credentials

**Status: PARTIAL**

## What passed

Recorded HTTP fixtures in `test/fixtures/providers/` drive Bright Data, Oxylabs, and Webshare through `setProviderFetch`:

| Provider | Recorded calls |
|----------|----------------|
| Bright Data | `GET /customer/balance`, `GET /zone/status?zone=` with `Bearer` |
| Oxylabs | `GET /v2/users/{userId}/client-stats` with `Bearer` |
| Webshare | proxy list, profile, and subscription with `Token` |

Parsed numbers come from those fixtures. Password, token, and api-key fields are removed or redacted. Account create/import/usage responses do not echo the fixture secrets.

Test: `test/proxy-provider-contracts.test.js`.

## Live opt-in (not run)

Set `PM_PROVIDER_LIVE=1` plus these environment variables (do not commit them):

- `PM_BRIGHTDATA_API_TOKEN`, `PM_BRIGHTDATA_CUSTOMER_ID`, `PM_BRIGHTDATA_ZONE`, `PM_BRIGHTDATA_ZONE_PASSWORD`
- `PM_OXYLABS_API_TOKEN`, `PM_OXYLABS_USER_ID`, `PM_OXYLABS_USERNAME`, `PM_OXYLABS_PASSWORD`
- `PM_WEBSHARE_TOKEN`

The live test is skipped in the default suite. This host did not call the provider APIs.

## Gap (why not VERIFIED)

Contract replay proves the adapter’s request shape and parsers. It does not prove a live subscription, balance, or proxy list from Bright Data, Oxylabs, or Webshare.
