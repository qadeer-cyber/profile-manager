# DIAGNOSTICS_CONTRACT.md — Profile Manager M2

**Contract version:** `DiagnosticsV1`  
**Status:** Approved M2 implementation contract  
**Frozen baseline:** `d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9`  
**Applies to:** Grok Backend, UI/UX and Independent QA agents

This document consolidates the approved Codex M2 technical handoff. It is the single authoritative contract for all three agents. Do not replace any field, enum, route or semantic with an independently invented alternative.

## 1. API routes

### GET `/api/profiles/:id/diagnostics`

Explicitly collects browser-level, read-only information for a selected running profile.

- Never creates, navigates or inspects a page.
- Uses the existing Playwright browser connection.
- Never enables a debugging TCP port.
- Returns the `DiagnosticsV1` response.
- Environment fields requiring a visible tab remain unavailable until separately collected.

### POST `/api/profiles/:id/diagnostics/environment`

Collects browser environment information using an explicitly requested, visibly foregrounded, application-owned diagnostic tab.

**Exact request body:**

```json
{
  "expectedLaunchId": "launch-uuid",
  "consent": "open-visible-diagnostic-tab"
}
```

Reject unknown properties or invalid consent.

The UI must obtain fresh, explicit consent for each request. No persistent automatic permission.

## 2. Exact TypeScript contract

```ts
type Availability =
  | "available"
  | "unavailable";

type Reason =
  | "not_running"
  | "launching"
  | "stopping"
  | "launch_changed"
  | "browser_disconnected"
  | "timeout"
  | "unsupported"
  | "permission_required"
  | "probe_closed"
  | "probe_navigated"
  | "collection_failed";

type Source =
  | "browser_protocol"
  | "launch_snapshot"
  | "visible_probe"
  | "manifest";

type Fact<T> =
  | {
      availability: "available";
      value: T;
      source: Source;
    }
  | {
      availability: "unavailable";
      value: null;
      source: null;
      reason: Reason;
    };

interface DiagnosticsV1 {
  schemaVersion: 1;

  profileId: string;

  observation: {
    id: string;
    launchId: string | null;
    requestedAt: string;
    completedAt: string;
    durationMs: number;
    validUntil: string | null;

    state:
      | "complete"
      | "partial"
      | "unavailable"
      | "invalidated";

    reason: Reason | null;
  };

  runtime: {
    chromiumVersion: Fact<string>;
    userAgent: Fact<string>;
  };

  expected: {
    chromiumVersion: Fact<string>;
  };

  environment: {
    timezone: Fact<string>;
    locale: Fact<string>;
    languages: Fact<string[]>;
  };

  proxy: Fact<
    | {
        configured: false;
      }
    | {
        configured: true;
        type: "http" | "https" | "socks5";
        host: string;
        port: number;
      }
  >;

  webrtc: {
    commandLinePolicy: Fact<
      | {
          state: "absent";
          value: null;
        }
      | {
          state: "present";
          value: string;
        }
      | {
          state: "conflicting";
          value: null;
        }
    >;

    effectivePolicy: Fact<string>;
    iceCollection: "not_collected";
  };

  consistency: {
    chromiumVersion:
      | "match"
      | "mismatch"
      | "unknown";
  };
}
```

## 3. Contract validation

All properties defined in `DiagnosticsV1` are required. Reject additional properties.

Field limits:

| Field | Maximum length |
|---|---:|
| Chromium version | 128 characters |
| User agent | 1,024 characters |
| Timezone | 128 characters |
| Locale / language entry | 128 characters |
| Proxy host | 253 characters |
| WebRTC policy | 128 characters |
| Languages array | 20 entries |

Additional validation:

- Proxy port must be an integer between 1 and 65535.
- `durationMs` must be finite and nonnegative.
- Timestamps must be valid UTC ISO-8601.
- Observation ID must be a new UUID for each request.
- Return only recognized WebRTC-policy values, not arbitrary command-line strings.
- `proxy` describes the configuration at launch time, not settings edited afterward.
- A stopped profile cannot return cached browser facts from its previous launch.
- An invalidated observation cannot return collected facts belonging to a superseded launch.
- Missing evidence must be reported as unavailable, never fabricated.

## 4. HTTP status and error contract

| HTTP status | Meaning |
|---|---|
| `200` | Complete, partial, unavailable or invalidated observation |
| `400` | Invalid profile ID, request body or unsupported properties |
| `401` | Missing or invalid authentication |
| `404` | Profile does not exist, after authentication |
| `409` | Expected launch ID does not match |
| `429` | Collection busy or request limit reached |
| `500` | Unexpected application failure, with sanitized response |

**Exact error response structure:**

```json
{
  "error": {
    "code": "DIAGNOSTICS_BUSY",
    "message": "A diagnostic observation is already running.",
    "requestId": "request-uuid"
  }
}
```

Allowed error codes:

```text
INVALID_REQUEST
UNAUTHORIZED
PROFILE_NOT_FOUND
LAUNCH_CHANGED
DIAGNOSTICS_BUSY
INTERNAL_ERROR
```

No raw exception, stack trace, command line or protocol response may appear in an HTTP error.

## 5. Authentication and transport

- Desktop routes require the existing `X-UI-Token`.
- Non-desktop access requires the existing automation API token through its established authentication headers.
- Authenticate before profile lookup or browser inspection.
- No authentication tokens in URLs, query parameters or diagnostic responses.
- Do not weaken middleware or enable permissive CORS.
- Do not expose automation tokens to the renderer to make diagnostics work.
- Set `Cache-Control: no-store` on successful and error responses.
- Preserve the existing global `/api/diagnostics` endpoint unchanged.

## 6. Runtime observation rules

| Fact | Approved source |
|---|---|
| Chromium version | Existing Playwright browser pipe, `Browser.getVersion` |
| Browser-level user agent | Same browser protocol |
| Expected Chromium version | Existing manifest |
| Timezone | Explicit visible diagnostic tab |
| Locale and navigator languages | Explicit visible diagnostic tab |
| Proxy configuration | Sanitized per-launch snapshot |
| WebRTC command-line policy | Parsed, allowlisted browser command-line observation |
| Effective WebRTC policy | Independent verification only; otherwise unavailable |
| Launch identity | Existing per-launch `launchId` |

Browser-level user agent must not be represented as proof of every page's effective user agent if page-specific overrides are possible.

An absent WebRTC command-line flag does not prove that no other WebRTC policy exists. Do not claim IP protection or anonymity from this information.

ICE candidates are not collected in M2.

No canvas, WebGL, audio or client-hint inspection is authorized in core M2.

## 7. Visible diagnostic-tab behavior

The user-facing disclosure must clearly say:

"Opens a visible diagnostic tab in the selected browser profile to read its timezone and language settings. Your existing pages will not be inspected. The tab will remain open until you close it."

Mandatory behavior:

1. Require an explicit user action and correct consent body.
2. Create one application-owned diagnostic tab.
3. Bring it to the foreground before observation.
4. Run only fixed, allowlisted environment-observation code.
5. Do not inspect existing browser tabs or user content.
6. Do not make external network requests.
7. Do not access cookies, localStorage or session storage.
8. Reject observations if the diagnostic tab navigates, closes or belongs to an outdated launch.
9. Never automatically close the diagnostic tab.
10. Never create a hidden tab or background probe.
11. Never change browser permissions or persisted profile settings.

## 8. Timeouts, concurrency and freshness

**Approved limits:**

- Total observation deadline: 3 seconds.
- Maximum concurrent collection: one active request per profile.
- Additional overlapping requests return HTTP 429.
- Display freshness ceiling: 30 seconds.
- Collection happens only after explicit user action.
- No background polling or recurring browser inspection.
- No persistent observation cache.

A timeout must not create an accumulating queue. Keep timed-out operations guarded until their underlying resources settle. Ignore late completion.

Before responding, verify that the profile still has the same active `launchId`.

A stop or relaunch immediately invalidates the previous launch's facts when known.

Browser-level and environment requests are separate snapshots. The UI may show them together only when their launch identities match, while preserving separate timestamps.

`validUntil` describes a display freshness ceiling, not a guarantee that the browser remains healthy.

## 9. Security and privacy

Never return or log:

- Proxy passwords or usernames.
- Tokens and session credentials.
- Cookies or browser storage contents.
- Complete process command lines.
- Credential-bearing proxy URLs.
- Local proxy-relay endpoints.
- User page URLs, titles, DOM or browsing history.
- Raw protocol responses or exceptions.
- Encryption keys or database content.

Do not serialize live browser-engine objects.

Do not open debugging TCP ports or enable automation automatically.

Diagnostic failures must not modify `last_error`, lifecycle classifications, browser locks, database rows or browser storage.

No new database migration or persisted diagnostic status.

## 10. QA acceptance requirements

All three agents must work against exactly this contract.

Independent QA must cover:

- Strict schema and enum validation.
- Authentication and access restrictions.
- Correct status and error responses.
- `Cache-Control: no-store`.
- Sensitive-data exclusion from payloads and logs.
- Browser observations with automation disabled.
- No additional debugging TCP port.
- Visible-tab consent and foreground behavior.
- No existing-page inspection or external requests.
- Stale launch identity and rapid relaunch.
- Timeouts, concurrency and resource cleanup.
- Unavailable, disconnected and invalidated responses.
- Existing lifecycle and recovery regressions.
- Existing proxy, storage, upgrade and uninstall preservation behavior.

Preserve all existing M1 test assertions.

## 11. Team ownership

**Backend:** `feature/m2-diagnostics-backend`

Own backend coordinator, engine observation adapter, routes and backend unit tests.

**UI:** `feature/m2-diagnostics-ui`

Own Diagnostics page, dedicated diagnostics component, UI hook, scoped styling and UI tests.

**QA:** `test/m2-diagnostics-acceptance`

Own independent contract, security, integration tests and acceptance matrix.

Do not modify another agent's files without prior approval.

## 12. Delivery gate

Each agent must acknowledge the same `DiagnosticsV1` contract before continuing contract-dependent implementation.

Implement locally on the assigned isolated branch. Do not commit or push before separate review authorization.

Return full diffs, test commands, results, security findings and outstanding blockers.

No merges, installer dispatches, releases, M3 work or M1 modifications.

**END OF AUTHORITATIVE M2 CONTRACT — VERSION 1**