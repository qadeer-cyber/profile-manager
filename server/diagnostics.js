// DiagnosticsV1 (schemaVersion 1). Field names and enums are the M2 contract.
// Working defaults pending Mohammad's confirmation are marked PENDING below.
import { randomUUID } from 'crypto';
import * as engine from './browsers.js';
import { MANIFEST } from './chromium.js';

export const COLLECTION_DEADLINE_MS = 3000;
export const FRESHNESS_MS = 30000;
export const DIAGNOSTIC_CONSENT = 'open-visible-diagnostic-tab';
const DIAGNOSTIC_MARKER = 'pm-diagnostics-v1';
const WEBRTC_POLICIES = new Set([
  'default',
  'default_public_and_private_interfaces',
  'default_public_interface_only',
  'disable_non_proxied_udp',
]);
const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEZONE = /^[A-Za-z0-9._+\-/]{1,128}$/;
const LANGUAGE = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/;

// PENDING: only DIAGNOSTICS_BUSY's sentence is quoted by the contract. The others restate §4.
const ERRORS = {
  INVALID_REQUEST: { status: 400, message: 'The diagnostic request is invalid.' },
  UNAUTHORIZED: { status: 401, message: 'Authentication is required.' },
  PROFILE_NOT_FOUND: { status: 404, message: 'Profile does not exist.' },
  LAUNCH_CHANGED: { status: 409, message: 'Expected launch ID does not match.' },
  DIAGNOSTICS_BUSY: { status: 429, message: 'A diagnostic observation is already running.' },
  INTERNAL_ERROR: { status: 500, message: 'Unexpected application failure.' },
};

const guards = new Map();
export function diagnosticsActiveCount() { return guards.size; }

function requestError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function diagnosticsHttpError(code) {
  const spec = ERRORS[code] || ERRORS.INTERNAL_ERROR;
  const resolved = ERRORS[code] ? code : 'INTERNAL_ERROR';
  return {
    status: spec.status,
    body: { error: { code: resolved, message: spec.message, requestId: randomUUID() } },
  };
}

function available(value, source) {
  return { availability: 'available', value, source };
}
function unavailable(reason) {
  return { availability: 'unavailable', value: null, source: null, reason };
}

function expectedChromium(override) {
  const value = override === undefined ? MANIFEST && MANIFEST.browserVersion : override;
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) return unavailable('collection_failed');
  return available(value, 'manifest');
}

// PENDING: effective WebRTC policy is always unsupported in M2. No ICE collection.
function effectivePolicy() {
  return unavailable('unsupported');
}

// PENDING: GET environment facts stay permission_required until a consented POST.
function permissionEnvironment() {
  return {
    timezone: unavailable('permission_required'),
    locale: unavailable('permission_required'),
    languages: unavailable('permission_required'),
  };
}

function environmentUnavailable(reason) {
  return {
    timezone: unavailable(reason),
    locale: unavailable(reason),
    languages: unavailable(reason),
  };
}

function environmentFrom(result) {
  if (!result || result.failed) return environmentUnavailable(result?.failed || 'collection_failed');
  return {
    timezone: result.timezone ? available(result.timezone, 'visible_probe') : unavailable('collection_failed'),
    locale: result.locale ? available(result.locale, 'visible_probe') : unavailable('collection_failed'),
    languages: result.languages ? available(result.languages, 'visible_probe') : unavailable('collection_failed'),
  };
}

function mapProxy(proxy, reason) {
  if (reason) return unavailable(reason);
  if (!proxy || proxy.state === 'suppressed') return unavailable('unsupported');
  if (proxy.state === 'off') return available({ configured: false }, 'launch_snapshot');
  const value = proxy.value;
  if (!value || value.configured !== true) return unavailable('collection_failed');
  if (!['http', 'https', 'socks5'].includes(value.type)) return unavailable('collection_failed');
  if (typeof value.host !== 'string' || value.host.length < 1 || value.host.length > 253) return unavailable('collection_failed');
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) return unavailable('collection_failed');
  return available({ configured: true, type: value.type, host: value.host, port: value.port }, 'launch_snapshot');
}

// OS adapter returns only the recognized policy summary.
function mapWebrtc(summary, reason) {
  if (reason) return unavailable(reason);
  if (!summary) return unavailable('collection_failed');
  if (summary.kind === 'absent') return available({ state: 'absent', value: null }, 'process_command_line');
  if (summary.kind === 'conflicting') return available({ state: 'conflicting', value: null }, 'process_command_line');
  if (summary.kind === 'present' && WEBRTC_POLICIES.has(summary.value)) {
    return available({ state: 'present', value: summary.value }, 'process_command_line');
  }
  return unavailable('collection_failed');
}

function mapRuntime(facts, reason) {
  if (reason) return { chromiumVersion: unavailable(reason), userAgent: unavailable(reason) };
  if (!facts || facts.cancelled) return { chromiumVersion: unavailable('timeout'), userAgent: unavailable('timeout') };
  const version = facts.chromiumVersion
    ? available(facts.chromiumVersion, 'browser_protocol')
    : unavailable('collection_failed');
  const userAgent = facts.userAgent
    ? available(facts.userAgent, 'browser_protocol')
    : unavailable('collection_failed');
  return { chromiumVersion: version, userAgent };
}

function consistency(runtime, expected) {
  if (runtime.availability !== 'available' || expected.availability !== 'available') return 'unknown';
  return runtime.value === expected.value ? 'match' : 'mismatch';
}

const REASON_ORDER = [
  'not_running', 'launching', 'stopping', 'browser_disconnected', 'launch_changed',
  'timeout', 'probe_closed', 'probe_navigated', 'collection_failed', 'unsupported', 'permission_required',
];

function primaryReason(required) {
  for (const reason of REASON_ORDER) {
    if (required.some(fact => fact.availability !== 'available' && fact.reason === reason)) return reason;
  }
  const failed = required.find(fact => fact.availability !== 'available');
  return failed ? failed.reason : 'collection_failed';
}

// Confirmed owner decision: completion is per operation.
// GET requires version, browser UA, manifest version, launch proxy, and a successful
// WebRTC command-line observation (absent and conflicting count as success).
// permission_required environment facts do not block GET completion.
// POST requires timezone, locale, and languages from the visible tab after consent
// and launch checks. Facts outside that scope do not block POST completion.
// effectivePolicy and iceCollection never count. complete is not used to hide a
// required failure. partial = some required facts obtained; unavailable = none;
// invalidated = the launch identity changed.
export function decideObservationState(mode, facts, invalidated = false) {
  if (invalidated) return { state: 'invalidated', reason: 'launch_changed' };
  const required = mode === 'environment'
    ? [facts.environment.timezone, facts.environment.locale, facts.environment.languages]
    : [facts.runtime.chromiumVersion, facts.runtime.userAgent, facts.expected, facts.proxy, facts.webrtc];
  const obtained = required.filter(fact => fact.availability === 'available').length;
  const live = mode === 'environment' ? required : [facts.runtime.chromiumVersion, facts.runtime.userAgent, facts.proxy, facts.webrtc];
  if (!live.some(fact => fact.availability === 'available')) return { state: 'unavailable', reason: primaryReason(live) };
  if (obtained === required.length) return { state: 'complete', reason: null };
  const reason = primaryReason(required);
  if (obtained === 0) return { state: 'unavailable', reason };
  return { state: 'partial', reason };
}

function buildPayload({ profileId, launchId, requestedMs, completedMs, facts, state, reason }) {
  const requestedAt = new Date(requestedMs).toISOString();
  const completedAt = new Date(completedMs).toISOString();
  const durationMs = Number.isFinite(completedMs - requestedMs) ? Math.max(0, completedMs - requestedMs) : 0;
  const showUntil = state === 'partial' || state === 'complete';
  return {
    schemaVersion: 1,
    profileId,
    observation: {
      id: randomUUID(),
      launchId,
      requestedAt,
      completedAt,
      durationMs,
      validUntil: showUntil ? new Date(completedMs + FRESHNESS_MS).toISOString() : null,
      state,
      reason,
    },
    runtime: facts.runtime,
    expected: { chromiumVersion: facts.expected },
    environment: facts.environment,
    proxy: facts.proxy,
    webrtc: {
      commandLinePolicy: facts.webrtc,
      effectivePolicy: effectivePolicy(),
      iceCollection: 'not_collected',
    },
    consistency: { chromiumVersion: consistency(facts.runtime.chromiumVersion, facts.expected) },
  };
}

function phaseReason(phase) {
  if (phase === 'launching') return 'launching';
  if (phase === 'stopping') return 'stopping';
  if (phase === 'disconnected') return 'browser_disconnected';
  return 'not_running';
}

function safeObserve(observe, profileId) {
  try {
    const view = observe(profileId);
    if (!view || typeof view !== 'object') return { phase: 'disconnected', launchId: null, proxy: { state: 'suppressed' } };
    return view;
  } catch {
    return { phase: 'disconnected', launchId: null, proxy: { state: 'suppressed' } };
  }
}

function defaultObserve(id) {
  if (typeof engine.diagnosticObservation !== 'function') {
    return { phase: 'not_running', launchId: null, proxy: { state: 'suppressed' } };
  }
  return engine.diagnosticObservation(id);
}

const DIAGNOSTIC_DOCUMENT = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${DIAGNOSTIC_MARKER}</title></head><body>${DIAGNOSTIC_MARKER}</body></html>`;

export function diagnosticDataUrl() {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(DIAGNOSTIC_DOCUMENT);
}

function ownedDiagnosticUrl(url, expected) {
  if (typeof url !== 'string' || url.length < 1 || url.length > 2000) return false;
  return url === expected;
}

export function readDiagnosticEnvironment() {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  const timezone = resolved && typeof resolved.timeZone === 'string' ? resolved.timeZone : '';
  const locale = typeof navigator !== 'undefined' && typeof navigator.language === 'string' ? navigator.language : '';
  const list = typeof navigator !== 'undefined' && Array.isArray(navigator.languages) ? Array.from(navigator.languages) : [];
  return { timezone, locale, languages: list, visible: document.visibilityState === 'visible' };
}

function validLanguage(value) {
  return typeof value === 'string' && value.length <= 128 && LANGUAGE.test(value);
}

function validLanguages(languages) {
  return Array.isArray(languages) && languages.length <= 20 && languages.every(validLanguage);
}

function validateEnvironment(raw) {
  if (!raw || typeof raw !== 'object' || raw.visible !== true) return { timezone: null, locale: null, languages: null };
  const timezone = typeof raw.timezone === 'string' && raw.timezone.length <= 128 && TIMEZONE.test(raw.timezone) ? raw.timezone : null;
  const locale = validLanguage(raw.locale) ? raw.locale : null;
  const languages = validLanguages(raw.languages) ? raw.languages.slice() : null;
  return { timezone, locale, languages };
}

async function pageClosed(page) {
  try {
    const value = page.isClosed?.();
    return !!(value && typeof value.then === 'function' ? await value : value);
  } catch {
    return true;
  }
}

function pageUrl(page) {
  try {
    const url = page.url?.();
    return typeof url === 'string' ? url : '';
  } catch {
    return '';
  }
}

async function readEnvironment(view, token, deadlineStart, deadlineMs) {
    if (token.cancelled) return { failed: 'timeout' };
    if (typeof view.openDiagnosticPage !== 'function') return { failed: 'collection_failed' };
  let page;
  const dataUrl = diagnosticDataUrl();
  let blocker;
  let navigated = false;
  let observing = false;
  const onNavigation = frame => { if (observing && (!page.mainFrame || frame === page.mainFrame())) navigated = true; };
  try {
    page = await view.openDiagnosticPage(token.hooks);
    if (token.cancelled) return { failed: 'timeout' };
    if (typeof page?.route !== 'function' || typeof page.bringToFront !== 'function' || typeof page.goto !== 'function' || typeof page.evaluate !== 'function') {
      return { failed: 'collection_failed' };
    }
    blocker = route => {
      let url = '';
      try { url = route.request().url(); } catch { url = ''; }
      if (url === dataUrl || url.startsWith('data:text/html') || url === 'about:blank') return route.continue();
      return route.abort();
    };
    await page.route('**/*', blocker);
    page.on?.('framenavigated', onNavigation);
    await page.bringToFront();
    const remaining = () => Math.max(1, deadlineMs - (Date.now() - deadlineStart));
    await page.goto(dataUrl, { waitUntil: 'domcontentloaded', timeout: remaining() });
    if (await pageClosed(page)) return { failed: 'probe_closed' };
    if (!ownedDiagnosticUrl(pageUrl(page), dataUrl)) return { failed: 'probe_navigated' };
    await page.bringToFront();
    if (token.cancelled) return { failed: 'timeout' };
    observing = true;
    const raw = await (page.diagnosticEvaluate || page.evaluate).call(page, readDiagnosticEnvironment);
    if (token.cancelled) return { failed: 'timeout' };
    if (await pageClosed(page)) return { failed: 'probe_closed' };
    if (!ownedDiagnosticUrl(pageUrl(page), dataUrl)) return { failed: 'probe_navigated' };
    if (navigated) return { failed: 'probe_navigated' };
    return validateEnvironment(raw);
  } catch {
    if (page && await pageClosed(page)) return { failed: 'probe_closed' };
    if (page && pageUrl(page) && !ownedDiagnosticUrl(pageUrl(page), dataUrl)) return { failed: 'probe_navigated' };
    return { failed: token.cancelled ? 'timeout' : 'collection_failed' };
  } finally {
    page?.off?.('framenavigated', onNavigation);
    if (blocker && page?.unroute) await page.unroute('**/*', blocker).catch(() => {});
  }
}

function blankFacts(reason, mode, expectedVersion) {
  return {
    runtime: mapRuntime(null, reason),
    expected: expectedChromium(expectedVersion),
    environment: mode === 'environment' ? environmentUnavailable(reason) : permissionEnvironment(),
    proxy: mapProxy(null, reason),
    webrtc: mapWebrtc(null, reason),
  };
}

function finishObservation(profileId, launchId, requestedMs, completedMs, mode, facts, invalidated = false) {
  const decided = decideObservationState(mode, facts, invalidated);
  if (decided.state === 'unavailable') {
    facts = { ...blankFacts(decided.reason, mode, null), expected: facts.expected };
  }
  return buildPayload({
    profileId, launchId, requestedMs, completedMs, facts,
    state: decided.state, reason: decided.reason,
  });
}

export async function collectDiagnostics(profileId, opts = {}) {
  if (guards.has(profileId)) throw requestError('DIAGNOSTICS_BUSY');
  const token = { cancelled: false, sessions: new Set(), controller: new AbortController(), done: false };
  guards.set(profileId, token);
  const release = () => {
    if (token.done) return;
    token.done = true;
    if (guards.get(profileId) === token) guards.delete(profileId);
  };
  const now = opts.now || Date.now;
  const requestedMs = now();
  const deadlineMs = opts.deadlineMs ?? COLLECTION_DEADLINE_MS;
  const observe = opts.observe || defaultObserve;
  const mode = opts.mode === 'environment' ? 'environment' : 'read';
  const expectedVersion = opts.expectedVersion;
  let timer;
  let hold = false;
  const started = safeObserve(observe, profileId);
  const launchAtStart = started.launchId ?? null;
  try {
    // PENDING: expectedLaunchId is an opaque exact match against the active launchId.
    if (mode === 'environment' && launchAtStart !== opts.expectedLaunchId) throw requestError('LAUNCH_CHANGED');
    const deadlineStart = Date.now();
    const work = (async () => {
      if (started.phase !== 'connected') {
        const reason = phaseReason(started.phase);
        return { kind: 'phase', launchId: launchAtStart, reason };
      }
      const hooks = {
        signal: token.controller.signal,
        cancelled: () => token.cancelled,
        trackSession: session => { token.sessions.add(session); if (token.cancelled) Promise.resolve().then(() => session.detach()).catch(() => {}); },
      };
      token.hooks = hooks;
      if (mode === 'environment' && started.headless === true) return { kind: 'phase', launchId: launchAtStart, reason: 'unsupported' };
      const [pipe, environment] = await Promise.all([
        typeof started.readPipeFacts === 'function'
          ? started.readPipeFacts(hooks).catch(() => null)
          : Promise.resolve(null),
        mode === 'environment'
          ? readEnvironment(started, token, deadlineStart, deadlineMs)
          : Promise.resolve(null),
      ]);
      if (token.cancelled) return { kind: 'timeout' };
      const after = safeObserve(observe, profileId);
      if (after.launchId !== launchAtStart || after.phase !== 'connected') return { kind: 'invalidated' };
      return { kind: 'ok', launchId: launchAtStart, proxy: started.proxy, pipe, environment };
    })();
    const timed = new Promise(resolve => {
      timer = setTimeout(() => {
        token.cancelled = true;
        token.controller.abort();
        for (const session of token.sessions) {
          if (typeof session.detach === 'function') Promise.resolve().then(() => session.detach()).catch(() => {});
        }
        resolve({ timeout: true });
      }, deadlineMs);
    });
    const outcome = await Promise.race([
      work.then(value => ({ timeout: false, value }), error => ({ timeout: false, error })),
      timed,
    ]);
    const completedMs = now();
    if (outcome.timeout) {
      hold = true;
      work.then(release, release);
      const after = safeObserve(observe, profileId);
      if (after.launchId !== launchAtStart) {
        return finishObservation(
          profileId, null, requestedMs, completedMs, mode,
          blankFacts('launch_changed', mode, expectedVersion), true,
        );
      }
      // Discard unfinished facts; the manifest alone is not live evidence.
      return finishObservation(
        profileId, launchAtStart, requestedMs, completedMs, mode,
        blankFacts('timeout', mode, expectedVersion),
      );
    }
    if (outcome.error) throw outcome.error;
    const value = outcome.value;
    if (!value || value.kind === 'timeout') {
      return finishObservation(
        profileId, launchAtStart, requestedMs, completedMs, mode,
        blankFacts('timeout', mode, expectedVersion),
      );
    }
    if (value.kind === 'invalidated') {
      return finishObservation(
        profileId, null, requestedMs, completedMs, mode,
        blankFacts('launch_changed', mode, expectedVersion), true,
      );
    }
    if (value.kind === 'phase') {
      return finishObservation(
        profileId, value.launchId ?? null, requestedMs, completedMs, mode,
        blankFacts(value.reason, mode, expectedVersion),
      );
    }
    if (value.pipe && value.pipe.cancelled) {
      return finishObservation(
        profileId, launchAtStart, requestedMs, completedMs, mode,
        blankFacts('timeout', mode, expectedVersion),
      );
    }
    const pipeReason = value.pipe ? null : 'collection_failed';
    const runtime = mapRuntime(value.pipe, pipeReason);
    const webrtc = mapWebrtc(value.pipe && value.pipe.webrtc, pipeReason);
    const environment = mode === 'environment' ? environmentFrom(value.environment) : permissionEnvironment();
    const facts = {
      runtime,
      expected: expectedChromium(expectedVersion),
      environment,
      proxy: mapProxy(value.proxy, null),
      webrtc,
    };
    return finishObservation(profileId, value.launchId ?? null, requestedMs, completedMs, mode, facts);
  } finally {
    clearTimeout(timer);
    if (!hold) release();
  }
}

export function isProfileDiagnosticsRequest(req) {
  const path = req?.path || '';
  return /^\/api\/profiles\/[^/]+\/diagnostics\/?$/.test(path)
    || /^\/api\/profiles\/[^/]+\/diagnostics\/environment\/?$/.test(path);
}

export function diagnosticsAuthorized(req, deps) {
  try {
    if (deps.uiToken) return deps.tokenOk(req.get('x-ui-token'), deps.uiToken) === true;
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.get('x-api-key');
    return deps.tokenOk(token, deps.apiToken) === true;
  } catch {
    return false;
  }
}

function validConsent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  if (keys.length !== 2 || !Object.prototype.hasOwnProperty.call(body, 'expectedLaunchId') || !Object.prototype.hasOwnProperty.call(body, 'consent')) return false;
  if (typeof body.expectedLaunchId !== 'string') return false;
  if (body.consent !== DIAGNOSTIC_CONSENT) return false;
  return true;
}

function sendError(res, code) {
  const { status, body } = diagnosticsHttpError(code);
  res.set('Cache-Control', 'no-store');
  res.status(status).json(body);
}

async function handle(req, res, deps, mode) {
  res.set('Cache-Control', 'no-store');
  try {
    if (!diagnosticsAuthorized(req, deps)) return sendError(res, 'UNAUTHORIZED');
    if (!PROFILE_ID.test(req.params.id || '')) return sendError(res, 'INVALID_REQUEST');
    if (mode === 'environment' && !validConsent(req.body)) return sendError(res, 'INVALID_REQUEST');
    const profile = deps.loadProfile(req.params.id);
    if (!profile) return sendError(res, 'PROFILE_NOT_FOUND');
    const payload = await collectDiagnostics(req.params.id, {
      mode,
      expectedLaunchId: mode === 'environment' ? req.body.expectedLaunchId : undefined,
      observe: deps.observe,
      now: deps.now,
      deadlineMs: deps.deadlineMs,
    });
    res.status(200).json(payload);
  } catch (error) {
    if (error && ERRORS[error.code]) return sendError(res, error.code);
    return sendError(res, 'INTERNAL_ERROR');
  }
}

export function mountProfileDiagnostics(app, deps) {
  app.get('/api/profiles/:id/diagnostics', (req, res) => handle(req, res, deps, 'read'));
  app.post('/api/profiles/:id/diagnostics/environment', (req, res) => handle(req, res, deps, 'environment'));
}
