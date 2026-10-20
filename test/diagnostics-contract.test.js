/**
 * M2 DiagnosticsV1 contract tests — full DIAGNOSTICS_CONTRACT.md (sections 1–12).
 * Validator (schema + semantics) is asserted at evidence level 1.
 * Live HTTP needs the backend: those stay todo 'Blocked: backend absent'.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { execFileSync } from 'node:child_process';
import {
  validateDiagnosticsV1,
  validateDiagnosticsErrorBody,
  validateEnvironmentPostBody,
  validDiagnosticsFixture,
  REASONS, SOURCES, OBSERVATION_STATES, ERROR_CODES, POST_CONSENT, LIMITS, WEBRTC_POLICY_VALUES,
  DISCLOSURE, FRESHNESS_CEILING_MS, OBSERVATION_DEADLINE_MS, canCombineSnapshots, assertFreshObservationIds,
  DURATION_TOLERANCE_MS, PROVISIONAL, findForbiddenMaterial, launchIdMatches, RELAY_ENDPOINT_RE, findRelayValue, GET_REQUIRED_FACTS, POST_REQUIRED_FACTS, requiredFactsFor,
} from './diagnostics-v1-validator.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// External artifact (not in the repo): override with PM_DIAG_CONTRACT. When absent, the contract-file tests are
// skipped with an explicit 'external artifact absent' reason, never passed silently.
const CONTRACT = process.env.PM_DIAG_CONTRACT || '/workspace/DIAGNOSTICS_CONTRACT.md';
const CONTRACT_SKIP = fs.existsSync(CONTRACT) ? false
  : `external artifact absent: DiagnosticsV1 contract not found at ${CONTRACT} (set PM_DIAG_CONTRACT; expected SHA-256 cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8)`;
const CONTRACT_SHA256 = 'cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8';

test('contract file is the verified full DiagnosticsV1 (SHA-256 pinned)', { skip: CONTRACT_SKIP }, () => {
  const raw = fs.readFileSync(CONTRACT);
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), CONTRACT_SHA256);
});

test('contract has sections 1–12 and the END marker; no truncation', { skip: CONTRACT_SKIP }, () => {
  const text = fs.readFileSync(CONTRACT, 'utf8');
  for (let n = 1; n <= 12; n++) assert.ok(new RegExp(`^## ${n}\\. `, 'm').test(text), `missing section ${n}`);
  assert.ok(text.includes('END OF AUTHORITATIVE M2 CONTRACT — VERSION 1'));
  assert.ok(!/TRUNCATED/i.test(text));
});

test('§7/§8 constants (no contract file needed)', () => {
  assert.equal(OBSERVATION_DEADLINE_MS, 3000);
  assert.equal(FRESHNESS_CEILING_MS, 30000);
  assert.ok(DISCLOSURE.startsWith('Opens a visible diagnostic tab'));
});

test('§7/§8 constants match contract text', { skip: CONTRACT_SKIP }, () => {
  const text = fs.readFileSync(CONTRACT, 'utf8');
  assert.ok(text.includes(DISCLOSURE), 'disclosure text');
  assert.ok(text.includes('Total observation deadline: 3 seconds.'));
  assert.ok(text.includes('Display freshness ceiling: 30 seconds.'));
  assert.equal(OBSERVATION_DEADLINE_MS, 3000);
  assert.equal(FRESHNESS_CEILING_MS, 30000);
});

test('baseline still has no server/diagnostics.js and no M2 routes', () => {
  const repository = process.env.PM_DIAG_REPOSITORY || root;
  const baseline = 'd7a000eeadd4f4645a608a1e0cc2b8ad154a75d9';
  const files = execFileSync('git', ['-C', repository, 'ls-tree', '-r', '--name-only', baseline], { encoding: 'utf8' }).split('\n');
  assert.equal(files.includes('server/diagnostics.js'), false);
  const src = execFileSync('git', ['-C', repository, 'show', `${baseline}:server/app.js`], { encoding: 'utf8' });
  assert.ok(!/profiles\/:id\/diagnostics/.test(src));
  assert.match(src, /ui\.get\('\/diagnostics'/); // global app-health unchanged presence
});

// ---- Validator self-tests ----

test('validator ACCEPTS hand-built valid DiagnosticsV1 fixture', () => {
  const r = validateDiagnosticsV1(validDiagnosticsFixture());
  assert.equal(r.ok, true, r.errors.join('\n'));
});

test('validator REJECTS extra root property', () => {
  const r = validateDiagnosticsV1(validDiagnosticsFixture({ extra: true }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /unexpected property 'extra'/.test(e)));
});

test('validator REJECTS wrong schemaVersion', () => {
  const r = validateDiagnosticsV1(validDiagnosticsFixture({ schemaVersion: 2 }));
  assert.equal(r.ok, false);
});

test('validator REJECTS Fact available without source / with value null inconsistency', () => {
  const bad = validDiagnosticsFixture({
    runtime: {
      chromiumVersion: { availability: 'available', value: '1', source: null },
      userAgent: { availability: 'available', value: 'ua', source: 'browser_protocol' },
    },
  });
  const r = validateDiagnosticsV1(bad);
  assert.equal(r.ok, false);
});

test('validator REJECTS Fact unavailable with non-null value', () => {
  const bad = validDiagnosticsFixture({
    environment: {
      timezone: { availability: 'unavailable', value: 'UTC', source: null, reason: 'permission_required' },
      locale: { availability: 'unavailable', value: null, source: null, reason: 'permission_required' },
      languages: { availability: 'unavailable', value: null, source: null, reason: 'permission_required' },
    },
  });
  const r = validateDiagnosticsV1(bad);
  assert.equal(r.ok, false);
});

test('validator REJECTS unknown Reason / Source / observation state', () => {
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    observation: {
      id: '22222222-2222-4222-8222-222222222222',
      launchId: null,
      requestedAt: '2026-10-19T16:00:00.000Z',
      completedAt: '2026-10-19T16:00:00.000Z',
      durationMs: 0,
      validUntil: null,
      state: 'complete',
      reason: 'not_a_real_reason',
    },
  })).ok, false);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    expected: {
      chromiumVersion: { availability: 'available', value: '1', source: 'invented_source' },
    },
  })).ok, false);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    observation: {
      id: '22222222-2222-4222-8222-222222222222',
      launchId: null,
      requestedAt: '2026-10-19T16:00:00.000Z',
      completedAt: '2026-10-19T16:00:00.000Z',
      durationMs: 0,
      validUntil: null,
      state: 'running',
      reason: null,
    },
  })).ok, false);
});

test('validator REJECTS field limit violations', () => {
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    runtime: {
      chromiumVersion: { availability: 'available', value: 'x'.repeat(LIMITS.chromiumVersion + 1), source: 'browser_protocol' },
      userAgent: { availability: 'available', value: 'ok', source: 'browser_protocol' },
    },
  })).ok, false);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    runtime: {
      chromiumVersion: { availability: 'available', value: '1', source: 'browser_protocol' },
      userAgent: { availability: 'available', value: 'u'.repeat(LIMITS.userAgent + 1), source: 'browser_protocol' },
    },
  })).ok, false);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    environment: {
      timezone: { availability: 'available', value: 't'.repeat(LIMITS.timezone + 1), source: 'visible_probe' },
      locale: { availability: 'unavailable', value: null, source: null, reason: 'permission_required' },
      languages: { availability: 'unavailable', value: null, source: null, reason: 'permission_required' },
    },
  })).ok, false);
  const langs = Array.from({ length: LIMITS.languagesMax + 1 }, (_, i) => `l${i}`);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    environment: {
      timezone: { availability: 'unavailable', value: null, source: null, reason: 'permission_required' },
      locale: { availability: 'unavailable', value: null, source: null, reason: 'permission_required' },
      languages: { availability: 'available', value: langs, source: 'visible_probe' },
    },
  })).ok, false);
});

test('validator REJECTS bad proxy port / host / durationMs / timestamps / observation id', () => {
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    proxy: {
      availability: 'available',
      value: { configured: true, type: 'http', host: 'h', port: 0 },
      source: 'launch_snapshot',
    },
  })).ok, false);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    proxy: {
      availability: 'available',
      value: { configured: true, type: 'http', host: 'h'.repeat(LIMITS.proxyHost + 1), port: 8080 },
      source: 'launch_snapshot',
    },
  })).ok, false);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    observation: {
      id: '22222222-2222-4222-8222-222222222222',
      launchId: null,
      requestedAt: '2026-10-19T16:00:00.000Z',
      completedAt: '2026-10-19T16:00:00.000Z',
      durationMs: -1,
      validUntil: null,
      state: 'unavailable',
      reason: 'not_running',
    },
  })).ok, false);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    observation: {
      id: 'not-a-uuid',
      launchId: null,
      requestedAt: '2026-10-19T16:00:00.000Z',
      completedAt: '2026-10-19T16:00:00.000Z',
      durationMs: 0,
      validUntil: null,
      state: 'unavailable',
      reason: 'not_running',
    },
  })).ok, false);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    observation: {
      id: '22222222-2222-4222-8222-222222222222',
      launchId: null,
      requestedAt: '2026-10-19T16:00:00', // missing Z
      completedAt: '2026-10-19T16:00:00.000Z',
      durationMs: 0,
      validUntil: null,
      state: 'unavailable',
      reason: 'not_running',
    },
  })).ok, false);
});

test('validator ACCEPTS commandLinePolicy union + REJECTS bad iceCollection / consistency', () => {
  for (const value of [
    { state: 'absent', value: null },
    { state: 'present', value: 'disable_non_proxied_udp' },
    { state: 'conflicting', value: null },
  ]) {
    const r = validateDiagnosticsV1(validDiagnosticsFixture({
      webrtc: {
        commandLinePolicy: { availability: 'available', value, source: 'process_command_line' },
        effectivePolicy: { availability: 'unavailable', value: null, source: null, reason: 'unsupported' },
        iceCollection: 'not_collected',
      },
    }));
    assert.equal(r.ok, true, r.errors.join('\n'));
  }
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    webrtc: {
      commandLinePolicy: { availability: 'available', value: { state: 'absent', value: null }, source: 'process_command_line' },
      effectivePolicy: { availability: 'unavailable', value: null, source: null, reason: 'unsupported' },
      iceCollection: 'collected',
    },
  })).ok, false);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({
    consistency: { chromiumVersion: 'maybe' },
  })).ok, false);
});

test('validator REJECTS error bodies with wrong shape or disallowed codes', () => {
  assert.equal(validateDiagnosticsErrorBody({
    error: { code: 'DIAGNOSTICS_BUSY', message: 'busy', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  }).ok, true);
  assert.equal(validateDiagnosticsErrorBody({ error: 'nope' }).ok, false);
  assert.equal(validateDiagnosticsErrorBody({
    error: { code: 'SOMETHING_ELSE', message: 'x', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  }).ok, false);
  assert.equal(validateDiagnosticsErrorBody({
    error: { code: 'INTERNAL_ERROR', message: 'fail', requestId: 'bad' },
  }).ok, false);
});

test('validator enforces POST body exactly {expectedLaunchId, consent}', () => {
  assert.equal(validateEnvironmentPostBody({
    expectedLaunchId: '33333333-3333-4333-8333-333333333333',
    consent: POST_CONSENT,
  }).ok, true);
  assert.equal(validateEnvironmentPostBody({
    expectedLaunchId: 'x',
    consent: POST_CONSENT,
    extra: 1,
  }).ok, false);
  assert.equal(validateEnvironmentPostBody({
    expectedLaunchId: 'x',
    consent: 'wrong',
  }).ok, false);
  assert.equal(validateEnvironmentPostBody({ consent: POST_CONSENT }).ok, false);
});

test('enum tables match contract section 2', () => {
  assert.deepEqual([...REASONS], [
    'not_running', 'launching', 'stopping', 'launch_changed', 'browser_disconnected',
    'timeout', 'unsupported', 'permission_required', 'probe_closed', 'probe_navigated',
    'collection_failed',
  ]);
  assert.deepEqual([...SOURCES], ['browser_protocol', 'process_command_line', 'launch_snapshot', 'visible_probe', 'manifest']);
  assert.deepEqual([...OBSERVATION_STATES], ['complete', 'partial', 'unavailable', 'invalidated']);
  assert.deepEqual([...ERROR_CODES], [
    'INVALID_REQUEST', 'UNAUTHORIZED', 'PROFILE_NOT_FOUND', 'LAUNCH_CHANGED', 'DIAGNOSTICS_BUSY', 'INTERNAL_ERROR',
  ]);
});

const webrtcWith = (value) => validDiagnosticsFixture({
  webrtc: {
    commandLinePolicy: { availability: 'available', value, source: 'process_command_line' },
    effectivePolicy: { availability: 'unavailable', value: null, source: null, reason: 'unsupported' },
    iceCollection: 'not_collected',
  },
});

test('webrtc commandLinePolicy present value: accepts each allowlisted policy', () => {
  assert.deepEqual([...WEBRTC_POLICY_VALUES], [
    'default', 'default_public_and_private_interfaces', 'default_public_interface_only', 'disable_non_proxied_udp',
  ]);
  for (const p of WEBRTC_POLICY_VALUES) {
    const r = validateDiagnosticsV1(webrtcWith({ state: 'present', value: p }));
    assert.equal(r.ok, true, `${p}: ${r.errors.join(';')}`);
  }
});

test('webrtc commandLinePolicy present value: rejects unrecognized / raw command-line strings', () => {
  for (const bad of ['disable', 'DISABLE_NON_PROXIED_UDP', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', 'disable_non_proxied_udp ', '']) {
    assert.equal(validateDiagnosticsV1(webrtcWith({ state: 'present', value: bad })).ok, false, `accepted '${bad}'`);
  }
});

test('webrtc §2 strict: absent/conflicting are AVAILABLE values {state, value:null}', () => {
  for (const state of ['absent', 'conflicting']) {
    const r = validateDiagnosticsV1(webrtcWith({ state, value: null }));
    assert.equal(r.ok, true, `${state}: ${r.errors.join(';')}`);
  }
});

const webrtcFact = (commandLinePolicy) => validDiagnosticsFixture({ webrtc: {
  commandLinePolicy,
  effectivePolicy: { availability: 'unavailable', value: null, source: null, reason: 'unsupported' },
  iceCollection: 'not_collected',
} });

test('webrtc §2 strict: rejects removed unavailable-with-reason encodings of absent/conflicting', () => {
  const bad = [
    // reason used as a stand-in for the state (not a §2 Reason)
    { availability: 'unavailable', value: null, source: null, reason: 'absent' },
    { availability: 'unavailable', value: null, source: null, reason: 'conflicting' },
    // unavailable carrying the state object
    { availability: 'unavailable', value: { state: 'absent', value: null }, source: null, reason: 'unsupported' },
    { availability: 'unavailable', value: { state: 'conflicting', value: null }, source: null, reason: 'collection_failed' },
    // unavailable with a source and state
    { availability: 'unavailable', value: null, source: 'launch_snapshot', reason: 'unsupported', state: 'absent' },
    // available but state omitted / value null guessed
    { availability: 'available', value: null, source: 'launch_snapshot' },
    { availability: 'available', value: { state: 'absent' }, source: 'launch_snapshot' },
    { availability: 'available', value: { state: 'absent', value: 'default' }, source: 'launch_snapshot' },
    { availability: 'available', value: { state: 'conflicting', value: 'disable_non_proxied_udp' }, source: 'launch_snapshot' },
    { availability: 'available', value: { state: 'present', value: null }, source: 'launch_snapshot' },
    { availability: 'available', value: { state: 'unknown', value: null }, source: 'launch_snapshot' },
    { availability: 'available', value: { state: 'absent', value: null, reason: 'unsupported' }, source: 'launch_snapshot' },
  ];
  for (const f of bad) {
    assert.equal(validateDiagnosticsV1(webrtcFact(f)).ok, false, `accepted ${JSON.stringify(f)}`);
  }
});

test('webrtc §2: generic Fact<T> unavailable (missing evidence, Reason enum) remains valid per Fact union', () => {
  // Not an encoding of absent/conflicting — §2 Fact<T> allows unavailable for any Fact (e.g. not_running).
  const r = validateDiagnosticsV1(webrtcFact({ availability: 'unavailable', value: null, source: null, reason: 'not_running' }));
  assert.equal(r.ok, true, r.errors.join(';'));
});

// ---- Semantic rules (§1, §3, §6, §8) ----
const U = (reason) => ({ availability: 'unavailable', value: null, source: null, reason });
const A = (value, source) => ({ availability: 'available', value, source });
const obs = (o) => ({ observation: { ...validDiagnosticsFixture().observation, ...o } });
const allUnavailable = (reason) => ({
  runtime: { chromiumVersion: U(reason), userAgent: U(reason) },
  environment: { timezone: U(reason), locale: U(reason), languages: U(reason) },
  proxy: U(reason),
  webrtc: { commandLinePolicy: U(reason), effectivePolicy: U(reason), iceCollection: 'not_collected' },
  consistency: { chromiumVersion: 'unknown' },
});

test('§8: validUntil must be after completedAt and within the 30 s freshness ceiling', () => {
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture(obs({ validUntil: '2026-10-19T16:00:30.000Z' }))).ok, true);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture(obs({ validUntil: '2026-10-19T16:00:30.001Z' }))).ok, false);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture(obs({ validUntil: '2026-10-19T16:00:00.000Z' }))).ok, false);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture(obs({ completedAt: '2026-10-19T15:59:59.000Z' }))).ok, false);
});

test('§2: reason null iff complete; unavailable/invalidated require a reason', () => {
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture(obs({ state: 'complete', reason: 'timeout' }))).ok, false);
  const stopped = validDiagnosticsFixture({ ...obs({ state: 'unavailable', reason: null, launchId: null, validUntil: null }), ...allUnavailable('not_running') });
  assert.equal(validateDiagnosticsV1(stopped).ok, false);
});

test('§3: stopped profile (unavailable/not_running) returns no cached launch facts', () => {
  const good = validDiagnosticsFixture({ ...obs({ state: 'unavailable', reason: 'not_running', launchId: null, validUntil: null }), ...allUnavailable('not_running') });
  assert.equal(validateDiagnosticsV1(good).ok, true, validateDiagnosticsV1(good).errors.join('\n'));
  // manifest expectation may stay available
  assert.equal(good.expected.chromiumVersion.availability, 'available');
  const cached = validDiagnosticsFixture({ ...obs({ state: 'unavailable', reason: 'not_running', launchId: null, validUntil: null }), ...allUnavailable('not_running'),
    runtime: { chromiumVersion: A('156.0.8078.4', 'browser_protocol'), userAgent: U('not_running') } });
  assert.equal(validateDiagnosticsV1(cached).ok, false);
});

test('§3/§8: invalidated observation carries no facts from the superseded launch', () => {
  for (const reason of ['launch_changed', 'probe_closed', 'probe_navigated']) {
    const good = validDiagnosticsFixture({ ...obs({ state: 'invalidated', reason, validUntil: null }), ...allUnavailable(reason) });
    assert.equal(validateDiagnosticsV1(good).ok, true, `${reason}: ${validateDiagnosticsV1(good).errors.join(';')}`);
  }
  const leak = validDiagnosticsFixture({ ...obs({ state: 'invalidated', reason: 'launch_changed', validUntil: null }), ...allUnavailable('launch_changed'),
    proxy: A({ configured: false }, 'launch_snapshot') });
  assert.equal(validateDiagnosticsV1(leak).ok, false);
});

test('available launch facts require a launchId', () => {
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture(obs({ launchId: null }))).ok, false);
});

test('§6: approved sources enforced per fact', () => {
  const bad = [
    { runtime: { chromiumVersion: A('156.0.8078.4', 'launch_snapshot'), userAgent: A('ua', 'browser_protocol') } },
    { runtime: { chromiumVersion: A('156.0.8078.4', 'browser_protocol'), userAgent: A('ua', 'visible_probe') } },
    { expected: { chromiumVersion: A('156.0.8078.4', 'browser_protocol') } },
    { environment: { timezone: A('UTC', 'browser_protocol'), locale: U('permission_required'), languages: U('permission_required') } },
    { proxy: A({ configured: false }, 'browser_protocol') },
    { webrtc: { commandLinePolicy: A({ state: 'absent', value: null }, 'visible_probe'), effectivePolicy: U('unsupported'), iceCollection: 'not_collected' } },
  ];
  for (const o of bad) assert.equal(validateDiagnosticsV1(validDiagnosticsFixture(o)).ok, false, JSON.stringify(o));
});

test('§3 never fabricated: consistency follows runtime vs expected version', () => {
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({ consistency: { chromiumVersion: 'mismatch' } })).ok, false);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({ consistency: { chromiumVersion: 'unknown' } })).ok, false);
  const diff = { runtime: { chromiumVersion: A('157.0.0.1', 'browser_protocol'), userAgent: A('ua', 'browser_protocol') } };
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({ ...diff, consistency: { chromiumVersion: 'mismatch' } })).ok, true);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({ ...diff, consistency: { chromiumVersion: 'match' } })).ok, false);
  const missing = { runtime: { chromiumVersion: U('timeout'), userAgent: A('ua', 'browser_protocol') } };
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({ ...missing, consistency: { chromiumVersion: 'unknown' } })).ok, true);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({ ...missing, consistency: { chromiumVersion: 'match' } })).ok, false);
});

test('§1: GET response keeps environment facts unavailable', () => {
  const getDone = obs({ state: 'complete', reason: null });
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture(getDone), { route: 'GET' }).ok, true);
  const env = { environment: { timezone: A('UTC', 'visible_probe'), locale: U('permission_required'), languages: U('permission_required') } };
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture(env)).ok, true);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({ ...getDone, ...env }), { route: 'GET' }).ok, false);
});

test('§8: snapshots combine only when launch identities match', () => {
  const a = validDiagnosticsFixture();
  const b = validDiagnosticsFixture(obs({ id: '44444444-4444-4444-8444-444444444444' }));
  assert.equal(canCombineSnapshots(a, b), true);
  assert.equal(canCombineSnapshots(a, validDiagnosticsFixture(obs({ launchId: '55555555-5555-4555-8555-555555555555' }))), false);
  assert.equal(canCombineSnapshots(validDiagnosticsFixture(obs({ launchId: null })), validDiagnosticsFixture(obs({ launchId: null }))), false);
});

test('§3: observation ids must be fresh per request', () => {
  const a = validDiagnosticsFixture();
  const b = validDiagnosticsFixture(obs({ id: '44444444-4444-4444-8444-444444444444' }));
  assert.equal(assertFreshObservationIds([a, b]).ok, true);
  assert.equal(assertFreshObservationIds([a, a]).ok, false);
});

// ---- Lead clarifications (hard) ----
test('§9 hard: relay-shaped URLs (scheme://loopback:port) anywhere in a response fail validation', () => {
  const relays = ['http://127.0.0.1:65530', 'socks5://localhost:1080', 'http://[::1]:9000/x',
    'http://user:pw@127.0.0.1:3128', 'HTTP://LOCALHOST:8080', 'socks5h://127.0.0.2:1'];
  for (const r of relays) {
    const body = validDiagnosticsFixture({ runtime: { chromiumVersion: A('156.0.8078.4', 'browser_protocol'), userAgent: A(`Mozilla/5.0 via ${r}`, 'browser_protocol') } });
    const res = validateDiagnosticsV1(body);
    assert.equal(res.ok, false, r);
    assert.ok(res.errors.some((e) => /relay/.test(e)), r);
  }
  assert.ok(findForbiddenMaterial({ error: { code: 'INTERNAL_ERROR', message: 'relay http://127.0.0.1:65530 down', requestId: 'x' } }).length > 0);
});

test('§9 no false positives: proxy.host 127.0.0.1/localhost with separate port field is allowed', () => {
  for (const host of ['127.0.0.1', 'localhost', 'proxy.example.com']) {
    const px = validDiagnosticsFixture({ proxy: A({ configured: true, type: 'http', host, port: 3128 }, 'launch_snapshot') });
    const res = validateDiagnosticsV1(px);
    assert.equal(res.ok, true, `${host}: ${res.errors.join(';')}`);
  }
  for (const s2 of ['127.0.0.1', 'localhost', '127.0.0.1:3128', 'http://localhost', 'https://example.com:8443'])
    assert.equal(RELAY_ENDPOINT_RE.test(s2), false, s2);
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture()).ok, true);
});

test('§9 live helper: findRelayValue fails on the actual relay value only', () => {
  const relay = 'http://127.0.0.1:61234';
  assert.ok(findRelayValue(`{"x":"${relay}"}`, relay).length > 0);
  assert.ok(findRelayValue('{"x":"127.0.0.1:61234"}', relay).length > 0);
  assert.deepEqual(findRelayValue('{"proxy":{"host":"127.0.0.1","port":61234}}', relay), []);
  assert.deepEqual(findRelayValue('{"x":"http://127.0.0.1:61235"}', relay), []);
  assert.deepEqual(findRelayValue('anything', null), []);
});

test('§9 hard: raw command-line flags / user-data-dir / remote-debugging fail validation', () => {
  for (const s of ['--user-data-dir=/tmp/p', 'x --proxy-server=http://a:1', '--remote-debugging-port=9222',
    'C:\\Users\\a\\user-data-dir', 'remote-debugging-pipe', '"--disable-features=X"', '--webrtc-ip-handling-policy=default']) {
    const body = validDiagnosticsFixture({ runtime: { chromiumVersion: A('156.0.8078.4', 'browser_protocol'), userAgent: A(s, 'browser_protocol') } });
    assert.equal(validateDiagnosticsV1(body).ok, false, s);
  }
  assert.equal(findForbiddenMaterial('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0.0.0').length, 0);
});

test('§6 hard: effective WebRTC policy is always unavailable in M2', () => {
  for (const src of ['browser_protocol', 'launch_snapshot']) {
    const b = validDiagnosticsFixture({ webrtc: { commandLinePolicy: A({ state: 'absent', value: null }, 'process_command_line'), effectivePolicy: A('default', src), iceCollection: 'not_collected' } });
    assert.equal(validateDiagnosticsV1(b, { provisional: false }).ok, false, src);
  }
});

test('lead default: durationMs ≤3000 clean, ≤3250 flagged as warning, >3250 fails', () => {
  assert.equal(DURATION_TOLERANCE_MS, 250);
  const at = (d) => validateDiagnosticsV1(validDiagnosticsFixture(obs({ durationMs: d })));
  assert.deepEqual([at(3000).ok, at(3000).warnings.length], [true, 0]);
  assert.deepEqual([at(3001).ok, at(3001).warnings.length], [true, 1]);
  assert.deepEqual([at(3250).ok, at(3250).warnings.length], [true, 1]);
  assert.equal(at(3251).ok, false);
});

test('lead default: expectedLaunchId is opaque and exact-match', () => {
  for (const id of ['launch-A1', '33333333-3333-4333-8333-333333333333', 'Ω-opaque']) {
    assert.equal(validateEnvironmentPostBody({ expectedLaunchId: id, consent: POST_CONSENT }).ok, true, id);
    assert.equal(launchIdMatches(id, id), true);
  }
  assert.equal(launchIdMatches('launch-A1', 'launch-a1'), false);
  assert.equal(launchIdMatches('launch-A1', ' launch-A1'), false);
  assert.equal(launchIdMatches('3f2a9c1e-aaaa-4bbb-8ccc-dddddddddddd', '3F2A9C1E-AAAA-4BBB-8CCC-DDDDDDDDDDDD'), false);
  assert.equal(launchIdMatches('', ''), false);
  assert.equal(launchIdMatches(null, null), false);
});

// ---- PROVISIONAL backend working defaults (pending Mohammad's confirmation) ----
test("PROVISIONAL: GET timezone/locale/languages unavailable with reason 'permission_required'", () => {
  assert.equal(PROVISIONAL.getEnvironmentReason, 'permission_required');
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture(obs({ state: 'complete', reason: null })), { route: 'GET' }).ok, true);
  const t2 = validDiagnosticsFixture({ ...obs({ state: 'complete', reason: null }), environment: { timezone: U('unsupported'), locale: U('permission_required'), languages: U('permission_required') } });
  assert.equal(validateDiagnosticsV1(t2, { route: 'GET' }).ok, false);
  assert.equal(validateDiagnosticsV1(t2, { route: 'GET', provisional: false }).ok, true);
});

test("PROVISIONAL: effectivePolicy reason 'unsupported'; commandLinePolicy source 'process_command_line'", () => {
  assert.equal(PROVISIONAL.effectivePolicyReason, 'unsupported');
  assert.equal(PROVISIONAL.commandLinePolicySource, 'process_command_line');
  const ep = validDiagnosticsFixture({ webrtc: { commandLinePolicy: A({ state: 'absent', value: null }, 'process_command_line'), effectivePolicy: U('timeout'), iceCollection: 'not_collected' } });
  assert.equal(validateDiagnosticsV1(ep).ok, false);
  assert.equal(validateDiagnosticsV1(ep, { provisional: false }).ok, true);
  const cl = validDiagnosticsFixture({ webrtc: { commandLinePolicy: A({ state: 'absent', value: null }, 'launch_snapshot'), effectivePolicy: U('unsupported'), iceCollection: 'not_collected' } });
  assert.equal(validateDiagnosticsV1(cl).ok, false);
  assert.equal(validateDiagnosticsV1(cl, { provisional: false }).ok, true);
});

// ---- OWNER DECISION: observation-state rules per operation (not provisional) ----
const ENV_OK = { timezone: A('UTC', 'visible_probe'), locale: A('en-US', 'visible_probe'), languages: A(['en-US', 'en'], 'visible_probe') };
const DONE = obs({ state: 'complete', reason: null });
const setFact = (body, p, f) => { const [k1, k2] = p.split('.'); return k2 ? { [k1]: { ...body[k1], [k2]: f } } : { [k1]: f }; };

test('owner: required fact sets per operation', () => {
  assert.deepEqual([...GET_REQUIRED_FACTS], ['runtime.chromiumVersion', 'runtime.userAgent', 'expected.chromiumVersion', 'proxy', 'webrtc.commandLinePolicy']);
  assert.deepEqual([...POST_REQUIRED_FACTS], ['environment.timezone', 'environment.locale', 'environment.languages']);
  assert.deepEqual([...requiredFactsFor()], [...GET_REQUIRED_FACTS, ...POST_REQUIRED_FACTS]);
});

test('owner GET: complete with env unavailable(permission_required); effectivePolicy/iceCollection never block', () => {
  const b = validDiagnosticsFixture(DONE);
  assert.equal(b.environment.timezone.reason, 'permission_required');
  assert.equal(b.webrtc.effectivePolicy.availability, 'unavailable');
  assert.equal(b.webrtc.iceCollection, 'not_collected');
  const r = validateDiagnosticsV1(b, { route: 'GET' });
  assert.equal(r.ok, true, r.errors.join('\n'));
  for (const v of [{ state: 'absent', value: null }, { state: 'conflicting', value: null }, { state: 'present', value: 'disable_non_proxied_udp' }]) {
    const w = validDiagnosticsFixture({ ...DONE, webrtc: { ...b.webrtc, commandLinePolicy: A(v, 'process_command_line') } });
    assert.equal(validateDiagnosticsV1(w, { route: 'GET' }).ok, true, JSON.stringify(v));
  }
});

test('owner NEG: GET marked complete with chromiumVersion unavailable is rejected', () => {
  const b = validDiagnosticsFixture({ ...DONE, runtime: { chromiumVersion: U('timeout'), userAgent: A('ua', 'browser_protocol') }, consistency: { chromiumVersion: 'unknown' } });
  const r = validateDiagnosticsV1(b, { route: 'GET' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /complete.*runtime\.chromiumVersion/.test(e)), r.errors.join('\n'));
});

test('owner NEG: GET complete with any required GET fact failed is rejected', () => {
  const base = validDiagnosticsFixture(DONE);
  for (const p of GET_REQUIRED_FACTS) {
    const extra = p.endsWith('chromiumVersion') ? { consistency: { chromiumVersion: 'unknown' } } : {};
    const b = validDiagnosticsFixture({ ...DONE, ...setFact(base, p, U('collection_failed')), ...extra });
    assert.equal(validateDiagnosticsV1(b, { route: 'GET' }).ok, false, p);
    const partial = validDiagnosticsFixture({ ...obs({ state: 'partial', reason: 'collection_failed' }), ...setFact(base, p, U('collection_failed')), ...extra });
    assert.equal(validateDiagnosticsV1(partial, { route: 'GET' }).ok, true, `${p} partial: ${validateDiagnosticsV1(partial, { route: 'GET' }).errors.join(';')}`);
  }
});

test('owner POST: complete when timezone/locale/languages from visible_probe; out-of-scope facts do not block', () => {
  const b = validDiagnosticsFixture({ ...DONE, environment: ENV_OK });
  assert.equal(validateDiagnosticsV1(b, { route: 'POST' }).ok, true, validateDiagnosticsV1(b, { route: 'POST' }).errors.join('\n'));
  const notRecollected = validDiagnosticsFixture({ ...DONE, environment: ENV_OK,
    runtime: { chromiumVersion: U('unsupported'), userAgent: U('unsupported') }, consistency: { chromiumVersion: 'unknown' },
    proxy: U('unsupported'), webrtc: { commandLinePolicy: U('unsupported'), effectivePolicy: U('unsupported'), iceCollection: 'not_collected' } });
  const r = validateDiagnosticsV1(notRecollected, { route: 'POST' });
  assert.equal(r.ok, true, r.errors.join('\n'));
  // environment from a non-probe source is rejected (§6)
  const wrongSrc = validDiagnosticsFixture({ ...DONE, environment: { ...ENV_OK, timezone: A('UTC', 'browser_protocol') } });
  assert.equal(validateDiagnosticsV1(wrongSrc, { route: 'POST' }).ok, false);
});

test('owner NEG: POST complete with timezone unavailable is rejected', () => {
  const b = validDiagnosticsFixture({ ...DONE, environment: { ...ENV_OK, timezone: U('timeout') } });
  const r = validateDiagnosticsV1(b, { route: 'POST' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /POST 'complete'.*environment\.timezone/.test(e)), r.errors.join('\n'));
  for (const p of POST_REQUIRED_FACTS) {
    const bb = validDiagnosticsFixture({ ...DONE, environment: { ...ENV_OK, [p.split('.')[1]]: U('probe_closed') } });
    assert.equal(validateDiagnosticsV1(bb, { route: 'POST' }).ok, false, p);
  }
});

test('owner NEG: POST complete without a verified launch identity is rejected', () => {
  const b = validDiagnosticsFixture({ ...obs({ state: 'complete', reason: null, launchId: null }), environment: ENV_OK,
    runtime: { chromiumVersion: U('not_running'), userAgent: U('not_running') }, consistency: { chromiumVersion: 'unknown' },
    proxy: U('not_running'), webrtc: { commandLinePolicy: U('not_running'), effectivePolicy: U('unsupported'), iceCollection: 'not_collected' } });
  assert.equal(validateDiagnosticsV1(b, { route: 'POST' }).ok, false);
});

test('owner NEG: partial with zero required facts obtained is rejected (should be unavailable)', () => {
  const none = { runtime: { chromiumVersion: U('timeout'), userAgent: U('timeout') }, consistency: { chromiumVersion: 'unknown' },
    proxy: U('timeout'), webrtc: { commandLinePolicy: U('timeout'), effectivePolicy: U('unsupported'), iceCollection: 'not_collected' } };
  const g = validDiagnosticsFixture({ ...obs({ state: 'partial', reason: 'timeout' }), ...none });
  assert.equal(validateDiagnosticsV1(g, { route: 'GET' }).ok, false);
  assert.ok(validateDiagnosticsV1(g, { route: 'GET' }).errors.some((e) => /must be 'unavailable'/.test(e)));
  const p = validDiagnosticsFixture({ ...obs({ state: 'partial', reason: 'timeout' }), environment: { timezone: U('timeout'), locale: U('timeout'), languages: U('timeout') } });
  assert.equal(validateDiagnosticsV1(p, { route: 'POST' }).ok, false);
  // same body as 'unavailable' is accepted
  const gu = validDiagnosticsFixture({ ...obs({ state: 'unavailable', reason: 'timeout', validUntil: null }), ...none });
  assert.equal(validateDiagnosticsV1(gu, { route: 'GET' }).ok, true, validateDiagnosticsV1(gu, { route: 'GET' }).errors.join('\n'));
});

test('owner NEG: unavailable with some required facts available is rejected', () => {
  const g = validDiagnosticsFixture({ ...obs({ state: 'unavailable', reason: 'timeout', validUntil: null }),
    runtime: { chromiumVersion: U('timeout'), userAgent: A('ua', 'browser_protocol') }, consistency: { chromiumVersion: 'unknown' },
    proxy: U('timeout'), webrtc: { commandLinePolicy: U('timeout'), effectivePolicy: U('unsupported'), iceCollection: 'not_collected' } });
  const r = validateDiagnosticsV1(g, { route: 'GET' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /'unavailable' but required facts obtained/.test(e)), r.errors.join('\n'));
  const p = validDiagnosticsFixture({ ...obs({ state: 'unavailable', reason: 'probe_closed', validUntil: null }),
    environment: { timezone: A('UTC', 'visible_probe'), locale: U('probe_closed'), languages: U('probe_closed') } });
  assert.equal(validateDiagnosticsV1(p, { route: 'POST' }).ok, false);
});

test('owner: partial = some required obtained, others failed; partial with all obtained is rejected', () => {
  const p = validDiagnosticsFixture({ ...obs({ state: 'partial', reason: 'timeout' }), environment: { ...ENV_OK, languages: U('timeout') } });
  assert.equal(validateDiagnosticsV1(p, { route: 'POST' }).ok, true, validateDiagnosticsV1(p, { route: 'POST' }).errors.join('\n'));
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture(), { route: 'GET' }).ok, false, 'partial with every GET fact obtained');
  assert.equal(validateDiagnosticsV1(validDiagnosticsFixture({ ...obs({ state: 'partial', reason: 'unsupported' }), environment: ENV_OK }), { route: 'POST' }).ok, false);
});

test('owner: invalidated (launch changed / observation invalid) carries no launch facts', () => {
  for (const route of ['GET', 'POST']) {
    const b = validDiagnosticsFixture({ ...obs({ state: 'invalidated', reason: 'launch_changed', validUntil: null }), ...allUnavailable('launch_changed') });
    assert.equal(validateDiagnosticsV1(b, { route }).ok, true, `${route}: ${validateDiagnosticsV1(b, { route }).errors.join(';')}`);
  }
});

test('live GET/POST bodies pass validateDiagnosticsV1 (GET with route:GET); errors pass validateDiagnosticsErrorBody', { todo: 'Blocked: backend absent' }, () => {});

test('authorized amendment is separately versioned and changes only Source', { skip: !process.env.PM_DIAG_AMENDED_CONTRACT && 'Set PM_DIAG_AMENDED_CONTRACT to the versioned backend contract' }, () => {
  const original = fs.readFileSync(CONTRACT, 'utf8');
  const amended = fs.readFileSync(process.env.PM_DIAG_AMENDED_CONTRACT, 'utf8');
  assert.equal(crypto.createHash('sha256').update(amended).digest('hex'), 'e80ce2d513e610a18c703b775fb0fd5520e3eb1ca5dce6f4ad43a1eecf08bdf4');
  assert.equal(amended, original.replace('  | "browser_protocol"\n', '  | "browser_protocol"\n  | "process_command_line"\n'));
});


test('owner F3: unavailable cannot advertise display freshness', () => {
  const empty = allUnavailable('not_running');
  const correct = validDiagnosticsFixture({ ...obs({ state: 'unavailable', reason: 'not_running', launchId: null, validUntil: null }), ...empty });
  assert.equal(validateDiagnosticsV1(correct, { route: 'GET' }).ok, true);
  correct.observation.validUntil = '2026-10-19T16:00:30.000Z';
  assert.equal(validateDiagnosticsV1(correct, { route: 'GET' }).ok, false);
});
