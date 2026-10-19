/**
 * DiagnosticsV1 schema validator (test-only; not production).
 * Implements DIAGNOSTICS_CONTRACT.md (external; default /workspace/, env PM_DIAG_CONTRACT) (DiagnosticsV1, sections 1–12,
 * SHA-256 cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8).
 * validateDiagnosticsV1 = §2/§3 schema + §1/§3/§6/§8 semantic rules.
 * WEBRTC_POLICY_VALUES is a QA-lead allowlist: the contract requires "recognized"
 * values but does not enumerate them.
 */

export const REASONS = Object.freeze([
  'not_running', 'launching', 'stopping', 'launch_changed', 'browser_disconnected',
  'timeout', 'unsupported', 'permission_required', 'probe_closed', 'probe_navigated',
  'collection_failed',
]);

export const SOURCES = Object.freeze([
  'browser_protocol', 'launch_snapshot', 'visible_probe', 'manifest',
]);

export const OBSERVATION_STATES = Object.freeze([
  'complete', 'partial', 'unavailable', 'invalidated',
]);

export const ERROR_CODES = Object.freeze([
  'INVALID_REQUEST', 'UNAUTHORIZED', 'PROFILE_NOT_FOUND',
  'LAUNCH_CHANGED', 'DIAGNOSTICS_BUSY', 'INTERNAL_ERROR',
]);

export const PROXY_TYPES = Object.freeze(['http', 'https', 'socks5']);
export const CONSISTENCY = Object.freeze(['match', 'mismatch', 'unknown']);
export const WEBRTC_POLICY_STATES = Object.freeze(['absent', 'present', 'conflicting']);
// QA-lead allowlist for recognized WebRTC IP-handling policy values (contract §3 "recognized values").
export const WEBRTC_POLICY_VALUES = Object.freeze([
  'default', 'default_public_and_private_interfaces', 'default_public_interface_only', 'disable_non_proxied_udp',
]);

export const LIMITS = Object.freeze({
  chromiumVersion: 128,
  userAgent: 1024,
  timezone: 128,
  localeOrLang: 128,
  proxyHost: 253,
  webrtcPolicy: 128,
  languagesMax: 20,
});

export const POST_CONSENT = 'open-visible-diagnostic-tab';

/** §7 exact user-facing disclosure. */
export const DISCLOSURE = 'Opens a visible diagnostic tab in the selected browser profile to read its timezone and language settings. Your existing pages will not be inspected. The tab will remain open until you close it.';

/** §8 limits. */
export const FRESHNESS_CEILING_MS = 30_000;
export const OBSERVATION_DEADLINE_MS = 3_000;
/** Lead working default: durationMs overshoot tolerance; >3000 warns, >3250 fails. */
export const DURATION_TOLERANCE_MS = 250;

/**
 * PROVISIONAL backend working defaults (pending Mohammad's confirmation).
 * Enforced by default; validateDiagnosticsV1(body, { provisional: false }) checks only the contract.
 */
export const PROVISIONAL = Object.freeze({
  getEnvironmentReason: 'permission_required', // §2 reason for "visible tab required"
  effectivePolicyReason: 'unsupported',
  commandLinePolicySource: 'browser_protocol',
});

/**
 * OWNER DECISION (2026-10-19): observation-state rules per operation. Not provisional.
 * GET required: chromiumVersion + browser-level userAgent, manifest expected version, current-launch proxy
 *   config, webrtc.commandLinePolicy observation (allowlisted value or verified absent/conflicting).
 *   Environment facts unavailable(permission_required) do not block GET completion.
 * POST required: timezone, locale, languages from visible_probe (+ launch identity/consent passed).
 *   Facts outside POST scope do not block completion.
 * Always: effectivePolicy may be unavailable; iceCollection 'not_collected' never counts.
 * complete = all required obtained; partial = some obtained, others failed; unavailable = none obtained;
 * invalidated = launch identity changed / observation invalid.
 */
export const GET_REQUIRED_FACTS = Object.freeze([
  'runtime.chromiumVersion', 'runtime.userAgent', 'expected.chromiumVersion', 'proxy', 'webrtc.commandLinePolicy',
]);
export const POST_REQUIRED_FACTS = Object.freeze([
  'environment.timezone', 'environment.locale', 'environment.languages',
]);
/**
 * QA interpretation (flagged): the manifest expectation is launch-independent, so it is required for GET
 * completion but does not by itself count as a "meaningful obtained" fact (a stopped profile is 'unavailable').
 */
export const LAUNCH_INDEPENDENT_FACTS = Object.freeze(['expected.chromiumVersion']);

/** Required facts for an operation. No route = conservative union of GET and POST. */
export function requiredFactsFor(route) {
  if (route === 'GET') return GET_REQUIRED_FACTS;
  if (route === 'POST') return POST_REQUIRED_FACTS;
  return Object.freeze([...GET_REQUIRED_FACTS, ...POST_REQUIRED_FACTS]);
}

/**
 * §9 fixture rule: relay-shaped URLs (scheme://[userinfo@]loopback:port) — hard failure.
 * Bare host strings and proxy.host='127.0.0.1' with a separate port field are allowed (no false positives).
 * Live tests additionally use findRelayValue() against the actual running-row relay_url.
 */
export const RELAY_ENDPOINT_RE = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s"'@/]*@)?(?:127(?:\.\d{1,3}){3}|localhost|\[::1\]):\d{1,5}\b/i;

/** §9 live rule: the actual relay endpoint (full URL or its host:port authority) must not appear. */
export function findRelayValue(text, relayUrl) {
  if (!relayUrl) return [];
  const errors = [];
  if (text.includes(relayUrl)) errors.push('response contains running-row relay_url (§9)');
  try {
    const u = new URL(relayUrl);
    if (u.port && text.includes(`${u.hostname}:${u.port}`)) errors.push('response contains relay host:port (§9)');
  } catch { /* non-URL value: full-string check above is the rule */ }
  return errors;
}
/** §9: raw command-line material — hard failure. */
export const CMDLINE_RES = Object.freeze([
  /(?:^|[\s"'=])--[a-z][a-z0-9-]*/i,
  /user-data-dir/i,
  /remote-debugging/i,
]);

/** Collect every string value in a JSON-like body with its path. */
export function collectStrings(x, p = 'root', out = []) {
  if (typeof x === 'string') out.push([p, x]);
  else if (Array.isArray(x)) x.forEach((y, i) => collectStrings(y, `${p}[${i}]`, out));
  else if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) collectStrings(y, `${p}.${k}`, out);
  return out;
}

/** §9 hard checks on any diagnostics response text/body (success or error). */
export function findForbiddenMaterial(bodyOrText) {
  const strs = typeof bodyOrText === 'string' ? [['text', bodyOrText]] : collectStrings(bodyOrText);
  const errors = [];
  for (const [p, s] of strs) {
    if (RELAY_ENDPOINT_RE.test(s)) errors.push(`${p}: local proxy-relay endpoint (§9)`);
    for (const re of CMDLINE_RES) if (re.test(s)) { errors.push(`${p}: raw command-line material ${re} (§9)`); break; }
  }
  return errors;
}

/** Lead working default: expectedLaunchId is opaque and matched exactly (no parsing/normalising). */
export function launchIdMatches(expected, active) {
  return typeof expected === 'string' && expected.length > 0 && typeof active === 'string' && expected === active;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function keysOf(o) {
  return Object.keys(o).sort();
}

function expectKeys(obj, required, path, errors) {
  if (!isPlainObject(obj)) {
    errors.push(`${path}: expected object`);
    return false;
  }
  const keys = keysOf(obj);
  const req = [...required].sort();
  for (const k of req) {
    if (!(k in obj)) errors.push(`${path}: missing required property '${k}'`);
  }
  for (const k of keys) {
    if (!required.includes(k)) errors.push(`${path}: unexpected property '${k}'`);
  }
  return errors.length === 0 || required.every((k) => k in obj);
}

function isUtcIso8601(s) {
  if (typeof s !== 'string' || !s) return false;
  // Require explicit UTC: trailing Z or +00:00 / -00:00
  if (!/(Z|[+-]00:00)$/.test(s)) return false;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return false;
  // Round-trip: parsed instant must equal the string's intent (allow millisecond precision)
  return true;
}

function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

function validateFact(fact, path, valueCheck, errors) {
  if (!isPlainObject(fact)) {
    errors.push(`${path}: Fact must be an object`);
    return;
  }
  const keys = keysOf(fact);
  if (!('availability' in fact)) {
    errors.push(`${path}: missing availability`);
    return;
  }
  if (fact.availability === 'available') {
    for (const k of keys) {
      if (!['availability', 'value', 'source'].includes(k)) {
        errors.push(`${path}: unexpected property '${k}'`);
      }
    }
    for (const k of ['availability', 'value', 'source']) {
      if (!(k in fact)) errors.push(`${path}: missing '${k}' for available Fact`);
    }
    if (!SOURCES.includes(fact.source)) {
      errors.push(`${path}: available Fact requires a Source enum value`);
    }
    if (valueCheck) valueCheck(fact.value, `${path}.value`, errors);
  } else if (fact.availability === 'unavailable') {
    for (const k of keys) {
      if (!['availability', 'value', 'source', 'reason'].includes(k)) {
        errors.push(`${path}: unexpected property '${k}'`);
      }
    }
    for (const k of ['availability', 'value', 'source', 'reason']) {
      if (!(k in fact)) errors.push(`${path}: missing '${k}' for unavailable Fact`);
    }
    if (fact.value !== null) errors.push(`${path}: unavailable Fact value must be null`);
    if (fact.source !== null) errors.push(`${path}: unavailable Fact source must be null`);
    if (!REASONS.includes(fact.reason)) {
      errors.push(`${path}: invalid reason '${fact.reason}'`);
    }
  } else {
    errors.push(`${path}: availability must be 'available' or 'unavailable'`);
  }
}

function validateStringLimit(v, path, max, errors) {
  if (typeof v !== 'string') {
    errors.push(`${path}: expected string`);
    return;
  }
  if (v.length > max) errors.push(`${path}: length ${v.length} exceeds ${max}`);
}

function validateProxyValue(v, path, errors) {
  if (!isPlainObject(v)) {
    errors.push(`${path}: expected proxy value object`);
    return;
  }
  if (v.configured === false) {
    expectKeys(v, ['configured'], path, errors);
    return;
  }
  if (v.configured === true) {
    expectKeys(v, ['configured', 'type', 'host', 'port'], path, errors);
    if (!PROXY_TYPES.includes(v.type)) errors.push(`${path}.type: invalid '${v.type}'`);
    validateStringLimit(v.host, `${path}.host`, LIMITS.proxyHost, errors);
    if (!Number.isInteger(v.port) || v.port < 1 || v.port > 65535) {
      errors.push(`${path}.port: must be integer 1..65535`);
    }
    return;
  }
  errors.push(`${path}.configured: must be boolean`);
}

function validateCommandLinePolicyValue(v, path, errors) {
  if (!isPlainObject(v) || !('state' in v) || !('value' in v)) {
    errors.push(`${path}: expected {state, value}`);
    return;
  }
  expectKeys(v, ['state', 'value'], path, errors);
  if (!WEBRTC_POLICY_STATES.includes(v.state)) {
    errors.push(`${path}.state: invalid '${v.state}'`);
    return;
  }
  if (v.state === 'present') {
    validateStringLimit(v.value, `${path}.value`, LIMITS.webrtcPolicy, errors);
    if (typeof v.value === 'string' && !WEBRTC_POLICY_VALUES.includes(v.value)) {
      errors.push(`${path}.value: unrecognized WebRTC policy '${v.value}'`);
    }
  } else if (v.value !== null) {
    errors.push(`${path}.value: must be null when state is '${v.state}'`);
  }
  // Contract §3: "Return only recognized WebRTC-policy values" — allowlist not enumerated
  // anywhere in the contract (sections 1–12); length + shape only here.
}

/**
 * Validate a DiagnosticsV1 success body.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateDiagnosticsV1(body, opts = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(body)) return { ok: false, errors: ['root: expected object'] };

  expectKeys(body, [
    'schemaVersion', 'profileId', 'observation', 'runtime', 'expected',
    'environment', 'proxy', 'webrtc', 'consistency',
  ], 'root', errors);

  if (body.schemaVersion !== 1) errors.push(`schemaVersion: must be literal 1, got ${JSON.stringify(body.schemaVersion)}`);
  if (typeof body.profileId !== 'string' || !body.profileId) {
    errors.push('profileId: expected non-empty string');
  }

  // observation
  if (isPlainObject(body.observation)) {
    expectKeys(body.observation, [
      'id', 'launchId', 'requestedAt', 'completedAt', 'durationMs', 'validUntil', 'state', 'reason',
    ], 'observation', errors);
    if (!isUuid(body.observation.id)) errors.push('observation.id: must be UUID');
    if (!(body.observation.launchId === null || typeof body.observation.launchId === 'string')) {
      errors.push('observation.launchId: must be string | null');
    }
    if (!isUtcIso8601(body.observation.requestedAt)) errors.push('observation.requestedAt: UTC ISO-8601 required');
    if (!isUtcIso8601(body.observation.completedAt)) errors.push('observation.completedAt: UTC ISO-8601 required');
    if (body.observation.validUntil !== null && !isUtcIso8601(body.observation.validUntil)) {
      errors.push('observation.validUntil: UTC ISO-8601 or null');
    }
    if (typeof body.observation.durationMs !== 'number'
      || !Number.isFinite(body.observation.durationMs)
      || body.observation.durationMs < 0) {
      errors.push('observation.durationMs: finite number >= 0');
    }
    if (!OBSERVATION_STATES.includes(body.observation.state)) {
      errors.push(`observation.state: invalid '${body.observation.state}'`);
    }
    if (!(body.observation.reason === null || REASONS.includes(body.observation.reason))) {
      errors.push(`observation.reason: invalid '${body.observation.reason}'`);
    }
  }

  // runtime
  if (isPlainObject(body.runtime)) {
    expectKeys(body.runtime, ['chromiumVersion', 'userAgent'], 'runtime', errors);
    validateFact(body.runtime.chromiumVersion, 'runtime.chromiumVersion', (v, p, e) => validateStringLimit(v, p, LIMITS.chromiumVersion, e), errors);
    validateFact(body.runtime.userAgent, 'runtime.userAgent', (v, p, e) => validateStringLimit(v, p, LIMITS.userAgent, e), errors);
  }

  // expected
  if (isPlainObject(body.expected)) {
    expectKeys(body.expected, ['chromiumVersion'], 'expected', errors);
    validateFact(body.expected.chromiumVersion, 'expected.chromiumVersion', (v, p, e) => validateStringLimit(v, p, LIMITS.chromiumVersion, e), errors);
  }

  // environment
  if (isPlainObject(body.environment)) {
    expectKeys(body.environment, ['timezone', 'locale', 'languages'], 'environment', errors);
    validateFact(body.environment.timezone, 'environment.timezone', (v, p, e) => validateStringLimit(v, p, LIMITS.timezone, e), errors);
    validateFact(body.environment.locale, 'environment.locale', (v, p, e) => validateStringLimit(v, p, LIMITS.localeOrLang, e), errors);
    validateFact(body.environment.languages, 'environment.languages', (v, p, e) => {
      if (!Array.isArray(v)) { e.push(`${p}: expected string[]`); return; }
      if (v.length > LIMITS.languagesMax) e.push(`${p}: max ${LIMITS.languagesMax} entries`);
      v.forEach((lang, i) => validateStringLimit(lang, `${p}[${i}]`, LIMITS.localeOrLang, e));
    }, errors);
  }

  // proxy Fact
  validateFact(body.proxy, 'proxy', validateProxyValue, errors);

  // webrtc
  if (isPlainObject(body.webrtc)) {
    expectKeys(body.webrtc, ['commandLinePolicy', 'effectivePolicy', 'iceCollection'], 'webrtc', errors);
    validateFact(body.webrtc.commandLinePolicy, 'webrtc.commandLinePolicy', validateCommandLinePolicyValue, errors);
    validateFact(body.webrtc.effectivePolicy, 'webrtc.effectivePolicy', (v, p, e) => validateStringLimit(v, p, LIMITS.webrtcPolicy, e), errors);
    if (body.webrtc.iceCollection !== 'not_collected') {
      errors.push(`webrtc.iceCollection: must be 'not_collected', got ${JSON.stringify(body.webrtc.iceCollection)}`);
    }
  }

  // consistency
  if (isPlainObject(body.consistency)) {
    expectKeys(body.consistency, ['chromiumVersion'], 'consistency', errors);
    if (!CONSISTENCY.includes(body.consistency.chromiumVersion)) {
      errors.push(`consistency.chromiumVersion: invalid '${body.consistency.chromiumVersion}'`);
    }
  }

  // Semantic rules only run on a structurally valid body.
  if (errors.length === 0) validateSemantics(body, opts, errors, warnings);
  // §9 hard failure regardless of structure.
  errors.push(...findForbiddenMaterial(body));
  return { ok: errors.length === 0, errors, warnings };
}

const isAvail = (f) => f?.availability === 'available';

/** Facts that belong to a specific launch (everything except the manifest expectation). */
function launchFacts(b) {
  return {
    'runtime.chromiumVersion': b.runtime.chromiumVersion,
    'runtime.userAgent': b.runtime.userAgent,
    'environment.timezone': b.environment.timezone,
    'environment.locale': b.environment.locale,
    'environment.languages': b.environment.languages,
    proxy: b.proxy,
    'webrtc.commandLinePolicy': b.webrtc.commandLinePolicy,
    'webrtc.effectivePolicy': b.webrtc.effectivePolicy,
  };
}

/**
 * Semantic rules derived from contract §1, §3, §6, §8.
 * opts.route: 'GET' (browser-level snapshot) | 'POST' (environment snapshot) | undefined.
 */
export function validateSemantics(b, opts, errors, warnings = []) {
  const o = b.observation;
  const prov = opts.provisional !== false;
  // Lead working default: 3000 ms deadline with ≤250 ms overshoot tolerance.
  if (o.durationMs > OBSERVATION_DEADLINE_MS + DURATION_TOLERANCE_MS) {
    errors.push(`observation.durationMs: ${o.durationMs} exceeds 3000+${DURATION_TOLERANCE_MS} ms`);
  } else if (o.durationMs > OBSERVATION_DEADLINE_MS) {
    warnings.push(`observation.durationMs: ${o.durationMs} over 3000 ms deadline (within tolerance) — flag`);
  }
  // §6: effective WebRTC policy stays unavailable in M2 (lead-clarified, hard).
  if (b.webrtc.effectivePolicy.availability !== 'unavailable') {
    errors.push('webrtc.effectivePolicy: must be unavailable in M2 (§6)');
  } else if (prov && b.webrtc.effectivePolicy.reason !== PROVISIONAL.effectivePolicyReason
      // open question: on unavailable/invalidated observations the observation reason is accepted
      && !((o.state === 'unavailable' || o.state === 'invalidated') && b.webrtc.effectivePolicy.reason === o.reason)) {
    errors.push(`webrtc.effectivePolicy.reason: PROVISIONAL must be '${PROVISIONAL.effectivePolicyReason}'`);
  }
  if (prov && isAvail(b.webrtc.commandLinePolicy) && b.webrtc.commandLinePolicy.source !== PROVISIONAL.commandLinePolicySource) {
    errors.push(`webrtc.commandLinePolicy.source: PROVISIONAL must be '${PROVISIONAL.commandLinePolicySource}'`);
  }
  // OWNER DECISION state rules (not provisional).
  {
    const get = (p) => p.split('.').reduce((x, k) => x?.[k], b);
    const required = requiredFactsFor(opts.route);
    const missing = required.filter((p) => !isAvail(get(p)));
    const obtained = required.filter((p) => isAvail(get(p)) && !LAUNCH_INDEPENDENT_FACTS.includes(p));
    const op = opts.route || 'GET+POST';
    if (o.state === 'complete' && missing.length) {
      errors.push(`observation.state: ${op} 'complete' requires all required facts; failed: ${missing.join(', ')}`);
    }
    if (o.state === 'complete' && opts.route === 'POST' && o.launchId === null) {
      errors.push("observation.state: POST 'complete' requires a verified launch identity");
    }
    if (o.state === 'partial' && missing.length === 0) {
      errors.push(`observation.state: all ${op} required facts obtained => must be 'complete', not 'partial'`);
    }
    if (o.state === 'partial' && obtained.length === 0) {
      errors.push(`observation.state: no ${op} required fact obtained => must be 'unavailable', not 'partial'`);
    }
    if (o.state === 'unavailable' && obtained.length > 0) {
      errors.push(`observation.state: 'unavailable' but required facts obtained: ${obtained.join(', ')}`);
    }
  }
  if (prov && opts.route === 'GET') {
    for (const k of ['timezone', 'locale', 'languages']) {
      const f = b.environment[k];
      if (!isAvail(f) && f.reason !== PROVISIONAL.getEnvironmentReason
          && !(o.state === 'unavailable' || o.state === 'invalidated')) {
        errors.push(`environment.${k}.reason: PROVISIONAL GET must be '${PROVISIONAL.getEnvironmentReason}'`);
      }
    }
  }
  const req = Date.parse(o.requestedAt), done = Date.parse(o.completedAt);
  // §2/§8: completion cannot precede the request.
  if (done < req) errors.push('observation.completedAt: precedes requestedAt');
  // §8: validUntil is a display freshness ceiling of at most 30 s after completion.
  if (o.validUntil !== null) {
    const vu = Date.parse(o.validUntil);
    if (vu <= done) errors.push('observation.validUntil: must be after completedAt');
    if (vu - done > FRESHNESS_CEILING_MS) errors.push('observation.validUntil: exceeds 30 s freshness ceiling');
  }
  // §2: reason is null exactly when nothing is missing.
  if (o.state === 'complete' && o.reason !== null) errors.push('observation.reason: must be null when state is complete');
  if ((o.state === 'unavailable' || o.state === 'invalidated') && o.reason === null) {
    errors.push(`observation.reason: required when state is ${o.state}`);
  }
  // §3: a stopped profile / invalidated observation returns no launch facts (no cache, no superseded facts).
  if (o.state === 'unavailable' || o.state === 'invalidated') {
    for (const [p, f] of Object.entries(launchFacts(b))) {
      if (isAvail(f)) errors.push(`${p}: must be unavailable when observation.state is ${o.state}`);
    }
  }
  // Facts from a launch require a launch identity.
  if (o.launchId === null) {
    for (const [p, f] of Object.entries(launchFacts(b))) {
      if (isAvail(f)) errors.push(`${p}: available fact requires a non-null observation.launchId`);
    }
  }
  // §6 approved sources (only where the contract names exactly one).
  const want = {
    'runtime.chromiumVersion': 'browser_protocol',
    'runtime.userAgent': 'browser_protocol',
    'environment.timezone': 'visible_probe',
    'environment.locale': 'visible_probe',
    'environment.languages': 'visible_probe',
    proxy: 'launch_snapshot',
  };
  for (const [p, src] of Object.entries(want)) {
    const f = launchFacts(b)[p];
    if (isAvail(f) && f.source !== src) errors.push(`${p}: source must be '${src}', got '${f.source}'`);
  }
  if (isAvail(b.expected.chromiumVersion) && b.expected.chromiumVersion.source !== 'manifest') {
    errors.push(`expected.chromiumVersion: source must be 'manifest'`);
  }
  // §6: visible_probe is only for environment facts.
  for (const p of ['webrtc.commandLinePolicy', 'webrtc.effectivePolicy']) {
    const f = launchFacts(b)[p];
    if (isAvail(f) && f.source === 'visible_probe') errors.push(`${p}: visible_probe is not an approved source`);
  }
  // §3 "never fabricated": consistency follows the two version facts.
  const rv = b.runtime.chromiumVersion, ev = b.expected.chromiumVersion, c = b.consistency.chromiumVersion;
  if (!isAvail(rv) || !isAvail(ev)) {
    if (c !== 'unknown') errors.push(`consistency.chromiumVersion: must be 'unknown' when a version is unavailable`);
  } else if (rv.value === ev.value && c !== 'match') {
    errors.push(`consistency.chromiumVersion: equal versions must be 'match'`);
  } else if (rv.value !== ev.value && c !== 'mismatch') {
    errors.push(`consistency.chromiumVersion: different versions must be 'mismatch'`);
  }
  // §1: GET never uses the visible tab, so environment facts stay unavailable.
  if (opts.route === 'GET') {
    for (const p of ['environment.timezone', 'environment.locale', 'environment.languages']) {
      if (isAvail(launchFacts(b)[p])) errors.push(`${p}: must be unavailable in a GET response`);
    }
  }
}

/** §8: an environment snapshot may be shown with a browser snapshot only when launch identities match. */
export function canCombineSnapshots(browserSnap, envSnap) {
  return browserSnap?.observation?.launchId != null
    && browserSnap.observation.launchId === envSnap?.observation?.launchId;
}

/** §3: observation ids must be fresh UUIDs per request. */
export function assertFreshObservationIds(bodies) {
  const ids = bodies.map((b) => b?.observation?.id);
  const errors = [];
  if (ids.some((id) => !isUuid(id))) errors.push('observation.id: all must be UUIDs');
  if (new Set(ids).size !== ids.length) errors.push('observation.id: reused across requests');
  return { ok: errors.length === 0, errors };
}

/**
 * Validate DiagnosticsV1 HTTP error body (§4).
 */
export function validateDiagnosticsErrorBody(body) {
  const errors = [];
  if (!isPlainObject(body)) return { ok: false, errors: ['root: expected object'] };
  expectKeys(body, ['error'], 'root', errors);
  if (!isPlainObject(body.error)) {
    errors.push('error: expected object');
    return { ok: false, errors };
  }
  expectKeys(body.error, ['code', 'message', 'requestId'], 'error', errors);
  if (!ERROR_CODES.includes(body.error.code)) {
    errors.push(`error.code: not an allowed code ('${body.error.code}')`);
  }
  if (typeof body.error.message !== 'string' || !body.error.message) {
    errors.push('error.message: non-empty string required');
  }
  if (!isUuid(body.error.requestId)) {
    errors.push('error.requestId: must be UUID');
  }
  // Sanitization heuristics (no stacks / raw CDP dumps)
  const blob = JSON.stringify(body);
  if (/\n\s*at\s+\S+/.test(blob) || /TypeError:|ReferenceError:/.test(blob)) {
    errors.push('error: appears to contain a stack/exception');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Validate POST /diagnostics/environment body (§1): exactly two properties.
 */
export function validateEnvironmentPostBody(body) {
  const errors = [];
  if (!isPlainObject(body)) return { ok: false, errors: ['root: expected object'] };
  expectKeys(body, ['expectedLaunchId', 'consent'], 'root', errors);
  if (typeof body.expectedLaunchId !== 'string' || !body.expectedLaunchId) {
    errors.push('expectedLaunchId: non-empty string required');
  }
  if (body.consent !== POST_CONSENT) {
    errors.push(`consent: must be exactly '${POST_CONSENT}'`);
  }
  return { ok: errors.length === 0, errors };
}

export function assertCacheControlNoStore(headers) {
  const raw = typeof headers?.get === 'function'
    ? headers.get('cache-control')
    : (headers?.['cache-control'] || headers?.['Cache-Control']);
  if (!raw || !/\bno-store\b/i.test(String(raw))) {
    return { ok: false, errors: [`Cache-Control must include no-store, got ${JSON.stringify(raw)}`] };
  }
  return { ok: true, errors: [] };
}

/** Hand-built valid fixture for self-tests. */
export function validDiagnosticsFixture(overrides = {}) {
  const now = '2026-10-19T16:00:00.000Z';
  const base = {
    schemaVersion: 1,
    profileId: '11111111-1111-4111-8111-111111111111',
    observation: {
      id: '22222222-2222-4222-8222-222222222222',
      launchId: '33333333-3333-4333-8333-333333333333',
      requestedAt: now,
      completedAt: now,
      durationMs: 12,
      validUntil: '2026-10-19T16:00:30.000Z',
      state: 'partial',
      reason: 'permission_required',
    },
    runtime: {
      chromiumVersion: { availability: 'available', value: '156.0.8078.4', source: 'browser_protocol' },
      userAgent: { availability: 'available', value: 'Mozilla/5.0 TestAgent', source: 'browser_protocol' },
    },
    expected: {
      chromiumVersion: { availability: 'available', value: '156.0.8078.4', source: 'manifest' },
    },
    environment: {
      timezone: { availability: 'unavailable', value: null, source: null, reason: 'permission_required' },
      locale: { availability: 'unavailable', value: null, source: null, reason: 'permission_required' },
      languages: { availability: 'unavailable', value: null, source: null, reason: 'permission_required' },
    },
    proxy: {
      availability: 'available',
      value: { configured: false },
      source: 'launch_snapshot',
    },
    webrtc: {
      commandLinePolicy: {
        availability: 'available',
        value: { state: 'absent', value: null },
        source: 'browser_protocol', // PROVISIONAL source
      },
      effectivePolicy: {
        availability: 'unavailable', value: null, source: null, reason: 'unsupported',
      },
      iceCollection: 'not_collected',
    },
    consistency: { chromiumVersion: 'match' },
  };
  return deepMerge(base, overrides);
}

function deepMerge(a, b) {
  if (!isPlainObject(b)) return b === undefined ? a : b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    // Fact objects (have availability) replace wholesale so unavailable→available
    // overrides do not retain stale reason/source/value keys.
    if (isPlainObject(v) && Object.prototype.hasOwnProperty.call(v, 'availability')) {
      out[k] = v;
    } else if (isPlainObject(a[k]) && isPlainObject(v)) {
      out[k] = deepMerge(a[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
