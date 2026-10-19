import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api, subscribe } from '../api.js';

// Per-profile DiagnosticsV1 state (docs: DIAGNOSTICS_CONTRACT.md, sections 1-6).
// - Fetches ONLY when refresh() / observeEnvironment() is called. No polling, no fetch timers.
// - One in-flight request per action; duplicate calls are ignored.
// - Responses for a superseded request or a different profile are dropped.
// - GET (runtime) and POST (environment) results are kept separately.
// - profile:started/stopped/crashed for the selected profile marks results superseded (no auto-fetch).

export const CONSENT = 'open-visible-diagnostic-tab';
export const REASONS = ['not_running', 'launching', 'stopping', 'launch_changed', 'browser_disconnected', 'timeout', 'unsupported', 'permission_required', 'probe_closed', 'probe_navigated', 'collection_failed'];
export const SOURCES = ['browser_protocol', 'launch_snapshot', 'visible_probe', 'manifest'];
export const STATES = ['complete', 'partial', 'unavailable', 'invalidated'];
export const CONSISTENCY = ['match', 'mismatch', 'unknown'];
export const ERROR_CODES = ['INVALID_REQUEST', 'UNAUTHORIZED', 'PROFILE_NOT_FOUND', 'LAUNCH_CHANGED', 'DIAGNOSTICS_BUSY', 'INTERNAL_ERROR'];
const STATUS_CODE = { 400: 'INVALID_REQUEST', 401: 'UNAUTHORIZED', 404: 'PROFILE_NOT_FOUND', 409: 'LAUNCH_CHANGED', 429: 'DIAGNOSTICS_BUSY', 500: 'INTERNAL_ERROR' };
const LIFECYCLE = new Set(['profile:started', 'profile:stopped', 'profile:crashed']);
// Same check api.js uses for its X-UI-Token header. Without it (web mode) the diagnostics routes require the
// automation token, which must not be exposed to the renderer (contract section 5), so no request is sent.
export const DESKTOP_SESSION = typeof window !== 'undefined' && !!window.pm?.uiToken;
// Transient failures keep the previous result on screen next to the error notice.
const TRANSIENT = new Set(['DIAGNOSTICS_BUSY', 'INTERNAL_ERROR']);
export const isTransient = err => err?.kind === 'network' || TRANSIENT.has(err?.code);
// A result is shown when it succeeded, or when it was kept through a transient error.
const shown = slot => slot.status === 'ok' || slot.status === 'error' ? slot.data : null;

// ---------- strict DiagnosticsV1 validation (section 2 + 3) ----------
class Bad extends Error {}
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (o, want, at) => {
  if (!isObj(o)) throw new Bad(`${at} is not an object`);
  const k = Object.keys(o);
  for (const w of want) if (!(w in o)) throw new Bad(`${at}.${w} is missing`);
  for (const x of k) if (!want.includes(x)) throw new Bad(`${at} has an unexpected property`);
};
const str = (v, max, at) => { if (typeof v !== 'string' || v.length > max) throw new Bad(`${at} is not a string of at most ${max} characters`); };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const ts = (v, at) => { if (typeof v !== 'string' || !ISO.test(v) || Number.isNaN(Date.parse(v))) throw new Bad(`${at} is not a UTC ISO-8601 timestamp`); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const oneOf = (v, list, at) => { if (!list.includes(v)) throw new Bad(`${at} has an unrecognized value`); };
function fact(f, at, checkValue) {
  if (!isObj(f)) throw new Bad(`${at} is not a fact`);
  if (f.availability === 'available') { keys(f, ['availability', 'value', 'source'], at); oneOf(f.source, SOURCES, `${at}.source`); checkValue(f.value, `${at}.value`); }
  else if (f.availability === 'unavailable') {
    keys(f, ['availability', 'value', 'source', 'reason'], at);
    if (f.value !== null || f.source !== null) throw new Bad(`${at} is unavailable but carries a value or source`);
    oneOf(f.reason, REASONS, `${at}.reason`);
  } else throw new Bad(`${at}.availability has an unrecognized value`);
}
const s128 = (v, at) => str(v, 128, at);
function proxyValue(v, at) {
  if (!isObj(v)) throw new Bad(`${at} is not an object`);
  if (v.configured === false) return keys(v, ['configured'], at);
  if (v.configured !== true) throw new Bad(`${at}.configured is not a boolean`);
  keys(v, ['configured', 'type', 'host', 'port'], at);
  oneOf(v.type, ['http', 'https', 'socks5'], `${at}.type`); str(v.host, 253, `${at}.host`);
  if (!v.host.length) throw new Bad(`${at}.host is empty`);
  if (!Number.isInteger(v.port) || v.port < 1 || v.port > 65535) throw new Bad(`${at}.port is out of range`);
}
function cmdPolicy(v, at) {
  if (!isObj(v)) throw new Bad(`${at} is not an object`);
  keys(v, ['state', 'value'], at);
  if (v.state === 'present') s128(v.value, `${at}.value`);
  else if (v.state === 'absent' || v.state === 'conflicting') { if (v.value !== null) throw new Bad(`${at}.value must be null`); }
  else throw new Bad(`${at}.state has an unrecognized value`);
}
export function validateDiagnosticsV1(d) {
  keys(d, ['schemaVersion', 'profileId', 'observation', 'runtime', 'expected', 'environment', 'proxy', 'webrtc', 'consistency'], 'response');
  if (d.schemaVersion !== 1) throw new Bad('response.schemaVersion is not 1');
  if (typeof d.profileId !== 'string' || !d.profileId) throw new Bad('response.profileId is not a string');
  const o = d.observation, at = 'observation';
  keys(o, ['id', 'launchId', 'requestedAt', 'completedAt', 'durationMs', 'validUntil', 'state', 'reason'], at);
  if (typeof o.id !== 'string' || !UUID.test(o.id)) throw new Bad(`${at}.id is not a UUID`);
  if (o.launchId !== null && (typeof o.launchId !== 'string' || !o.launchId)) throw new Bad(`${at}.launchId is not a string or null`);
  ts(o.requestedAt, `${at}.requestedAt`); ts(o.completedAt, `${at}.completedAt`);
  if (o.validUntil !== null) ts(o.validUntil, `${at}.validUntil`);
  if (typeof o.durationMs !== 'number' || !Number.isFinite(o.durationMs) || o.durationMs < 0) throw new Bad(`${at}.durationMs is not a finite nonnegative number`);
  oneOf(o.state, STATES, `${at}.state`);
  if (o.reason !== null) oneOf(o.reason, REASONS, `${at}.reason`);
  keys(d.runtime, ['chromiumVersion', 'userAgent'], 'runtime');
  fact(d.runtime.chromiumVersion, 'runtime.chromiumVersion', s128);
  fact(d.runtime.userAgent, 'runtime.userAgent', (v, a) => str(v, 1024, a));
  keys(d.expected, ['chromiumVersion'], 'expected');
  fact(d.expected.chromiumVersion, 'expected.chromiumVersion', s128);
  keys(d.environment, ['timezone', 'locale', 'languages'], 'environment');
  fact(d.environment.timezone, 'environment.timezone', s128);
  fact(d.environment.locale, 'environment.locale', s128);
  fact(d.environment.languages, 'environment.languages', (v, a) => {
    if (!Array.isArray(v) || v.length > 20) throw new Bad(`${a} is not an array of at most 20 entries`);
    v.forEach((x, i) => s128(x, `${a}[${i}]`));
  });
  fact(d.proxy, 'proxy', proxyValue);
  keys(d.webrtc, ['commandLinePolicy', 'effectivePolicy', 'iceCollection'], 'webrtc');
  fact(d.webrtc.commandLinePolicy, 'webrtc.commandLinePolicy', cmdPolicy);
  fact(d.webrtc.effectivePolicy, 'webrtc.effectivePolicy', s128);
  if (d.webrtc.iceCollection !== 'not_collected') throw new Bad('webrtc.iceCollection is not "not_collected"');
  keys(d.consistency, ['chromiumVersion'], 'consistency');
  oneOf(d.consistency.chromiumVersion, CONSISTENCY, 'consistency.chromiumVersion');
  return d;
}
const check = d => { try { validateDiagnosticsV1(d); return null; } catch (e) { if (e instanceof Bad) return e.message; throw e; } };

// ---------- errors (section 4) ----------
// api() throws Error{status, code}. With the contract body {error:{code,message,requestId}} api() cannot
// surface code/requestId (its message becomes "[object Object]"), so the code is derived from the status.
// e.message is never rendered.
export function toError(e) {
  if (e?.kind) return e;
  const status = typeof e?.status === 'number' ? e.status : null;
  const code = ERROR_CODES.includes(e?.code) ? e.code : STATUS_CODE[status] || null;
  const requestId = typeof e?.requestId === 'string' && UUID.test(e.requestId) ? e.requestId : null;
  return { kind: status ? 'http' : 'network', status, code, requestId, at: new Date().toISOString() };
}

const idle = { status: 'idle', data: null, error: null, superseded: null, requestedFor: null };
const initial = profileId => ({ profileId, runtime: idle, env: idle });
function reducer(s, a) {
  switch (a.type) {
    case 'reset': return initial(a.profileId);
    case 'start': return { ...s, [a.slot]: { ...s[a.slot], status: 'loading', error: null, requestedFor: a.launchId ?? null } };
    case 'ok': return { ...s, [a.slot]: { status: 'ok', data: a.data, error: null, superseded: a.superseded, requestedFor: s[a.slot].requestedFor } };
    case 'fail': return { ...s, [a.slot]: { ...s[a.slot], status: 'error', error: a.error, data: a.keepData ? s[a.slot].data : null } };
    case 'lifecycle': {
      const mark = slot => s[slot].data || s[slot].status === 'loading' ? { ...s[slot], superseded: { type: a.event, at: a.at } } : s[slot];
      return { ...s, runtime: mark('runtime'), env: mark('env') };
    }
    default: return s;
  }
}

// onProfileEvent (optional) receives every profile:* event, so callers can share this hook's single
// subscription (in web mode each subscribe() opens its own EventSource connection).
export function useProfileDiagnostics(profileId, { onProfileEvent } = {}) {
  const [state, dispatch] = useReducer(reducer, profileId, initial);
  const current = useRef(profileId);           // currently selected profile
  const seq = useRef({ runtime: 0, env: 0 });   // request sequence tokens
  const busy = useRef({ runtime: false, env: false });
  const epoch = useRef(0);                      // bumps on lifecycle events for the selected profile
  const lastLifecycle = useRef(null);

  useEffect(() => {
    current.current = profileId;
    seq.current = { runtime: seq.current.runtime + 1, env: seq.current.env + 1 }; // supersede anything in flight
    busy.current = { runtime: false, env: false };
    epoch.current = 0; lastLifecycle.current = null;
    dispatch({ type: 'reset', profileId });
  }, [profileId]);

  const onEvent = useRef(onProfileEvent); onEvent.current = onProfileEvent;
  useEffect(() => subscribe(e => {
    if (typeof e?.type === 'string' && e.type.startsWith('profile:')) onEvent.current?.(e);
    if (!e || !LIFECYCLE.has(e.type) || !current.current || e.id !== current.current) return;
    epoch.current++; lastLifecycle.current = { type: e.type, at: typeof e.at === 'string' ? e.at : new Date().toISOString() };
    dispatch({ type: 'lifecycle', event: e.type, at: lastLifecycle.current.at });
  }), []);

  const run = useCallback(async (slot, url, opts) => {
    const id = current.current;
    if (!DESKTOP_SESSION || !id || busy.current[slot]) return false;
    busy.current[slot] = true;
    const mine = ++seq.current[slot], startEpoch = epoch.current;
    const live = () => mine === seq.current[slot] && id === current.current;
    dispatch({ type: 'start', slot, launchId: opts?.body?.expectedLaunchId });
    try {
      const data = await api(url, opts);
      if (!live()) return false; // superseded request or a different profile is selected now: drop
      const problem = check(data);
      if (problem) { dispatch({ type: 'fail', slot, error: { kind: 'malformed', detail: problem, at: new Date().toISOString() } }); return false; }
      if (data.profileId !== id) { dispatch({ type: 'fail', slot, error: { kind: 'wrong_profile', at: new Date().toISOString() } }); return false; }
      dispatch({ type: 'ok', slot, data, superseded: epoch.current !== startEpoch ? lastLifecycle.current : null });
      return true;
    } catch (e) {
      if (!live()) return false;
      const error = toError(e);
      dispatch({ type: 'fail', slot, error, keepData: isTransient(error) });
      if (error.code === 'LAUNCH_CHANGED' && slot === 'env') dispatch({ type: 'lifecycle', event: 'launch_changed', at: error.at });
      return false;
    } finally { if (mine === seq.current[slot]) busy.current[slot] = false; }
  }, []);

  const refresh = useCallback(() => {
    const id = current.current;
    return run('runtime', `/api/profiles/${encodeURIComponent(id)}/diagnostics`, { cache: 'no-store' });
  }, [run]);

  const runtimeData = shown(state.runtime);
  const runtimeObs = runtimeData ? runtimeData.observation : null;
  const expectedLaunchId = runtimeObs?.launchId ?? null;
  const canObserveEnvironment = DESKTOP_SESSION && !!expectedLaunchId && !state.runtime.superseded && runtimeObs.state !== 'invalidated'
    && state.env.status !== 'loading';

  // `consent` must be the literal returned by the disclosure dialog's confirm action, for this request only.
  const observeEnvironment = useCallback(consent => {
    if (consent !== CONSENT || !canObserveEnvironment) return Promise.resolve(false);
    const id = current.current;
    return run('env', `/api/profiles/${encodeURIComponent(id)}/diagnostics/environment`,
      { method: 'POST', cache: 'no-store', body: { expectedLaunchId, consent: CONSENT } });
  }, [run, canObserveEnvironment, expectedLaunchId]);

  const envData = shown(state.env);
  const envMatchesLaunch = !!envData && !!expectedLaunchId && envData.observation.launchId === expectedLaunchId;

  return {
    runtime: state.runtime, env: state.env, profileId: state.profileId, available: DESKTOP_SESSION,
    runtimeData, envData,
    refresh, observeEnvironment, canObserveEnvironment, expectedLaunchId, envMatchesLaunch,
    loading: state.runtime.status === 'loading', envLoading: state.env.status === 'loading',
  };
}
