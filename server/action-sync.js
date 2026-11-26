// Controlled action synchronization (parity gap 19, Dolphin Anty "synchronizer").
//
// Mirrors a person's own input from one explicitly chosen *leader* profile to explicitly chosen
// *follower* profiles. Boundaries:
//   - Only running Chromium profiles that this app launched through Playwright (a live browser
//     context it controls). Native-runtime and Firefox profiles are refused with a reason.
//   - Only the profiles named when the session starts; a profile can be in one session at a time.
//   - Clicks (viewport-relative position), wheel scrolling, key presses and navigation are
//     mirrored. Typing into password fields is never mirrored. Captured input is never logged.
//   - The session stops on request, when the leader closes, or when any participant stops.
// Nothing runs unless a person starts a session.
import { randomUUID } from 'node:crypto';

export const MAX_FOLLOWERS = 10;
const BINDING = '__azwahSyncEmit';

// Runs in the leader's pages. Reports input only while the binding exists; it never reads values.
function capture(sessionId) {
  const previous = window.__azwahSyncInstalled;
  if (previous?.id === sessionId) return;
  previous?.controller.abort();
  const controller = new AbortController();
  window.__azwahSyncInstalled = { id: sessionId, controller };
  const options = { capture: true, signal: controller.signal };
  const send = event => window.__azwahSyncEmit({ ...event, sessionId }).catch(() => {});
  const isSecret = el => el?.matches?.('input[type=password],input[type=email],input[type=tel],[autocomplete~=username],[autocomplete~=one-time-code],[autocomplete*=password],[autocomplete*=cc-]')
    || /pass(word|code)?|otp|secret|token|credential|user.?name|card.?num|cvc|cvv/i.test([el?.name, el?.id, el?.autocomplete].join(' '));
  addEventListener('click', ev => {
    if (ev.isTrusted) send({ type: 'click', x: ev.clientX / innerWidth, y: ev.clientY / innerHeight, button: ev.button });
  }, options);
  addEventListener('wheel', ev => {
    if (ev.isTrusted) send({ type: 'wheel', dx: ev.deltaX, dy: ev.deltaY });
  }, { ...options, passive: true });
  addEventListener('keydown', ev => {
    if (!ev.isTrusted || ev.isComposing || ev.composedPath().some(isSecret)) return;
    if ((ev.ctrlKey || ev.metaKey) && ['v', 'c', 'x'].includes(ev.key.toLowerCase())) return;
    if (ev.shiftKey && ev.key === 'Insert') return;
    const mods = [ev.ctrlKey && 'Control', ev.altKey && 'Alt', ev.metaKey && 'Meta', ev.shiftKey && ev.key.length > 1 && 'Shift'].filter(Boolean);
    send({ type: 'key', key: [...mods, ev.key].join('+') });
  }, options);
}

function safeNavigation(raw) {
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

const err = (status, message, code) => Object.assign(new Error(message), { status, code });

export function createActionSync({ liveContext, isRunning, profileName = id => id, emit = () => {}, now = () => Date.now() }) {
  const sessions = new Map();
  const memberOf = new Map();
  const stopped = new Map(); // bounded summaries for repeated Stop requests
  const prepared = new WeakMap(); // one binding per browser context
  const activeFor = leaderId => { const cur = sessions.get(memberOf.get(leaderId)); return cur && cur.state === 'active' && cur.leaderId === leaderId ? cur : null; };

  const summary = s => ({ id: s.id, leaderId: s.leaderId, followerIds: [...s.followerIds], state: s.state, startedAt: s.startedAt,
    stoppedAt: s.stoppedAt || null, stopReason: s.stopReason || null, mirrored: { ...s.counts }, errors: s.errors });

  async function mirror(s, event) {
    if (s.state !== 'active') return;
    s.counts[event.type] = (s.counts[event.type] || 0) + 1;
    await Promise.all([...s.followerIds].map(async id => {
      if (s.state !== 'active') return;
      const ctx = liveContext(id);
      if (!ctx) return stop(s.id, `follower ${profileName(id)} is no longer running`);
      const page = ctx.pages()[event.pageIndex ?? 0] || ctx.pages()[0];
      if (!page) return;
      try {
        if (event.type === 'click') {
          const size = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
          if (s.state !== 'active') return;
          await page.mouse.click(Math.round(event.x * size.width), Math.round(event.y * size.height), { button: ['left', 'middle', 'right'][event.button] || 'left' });
        } else if (event.type === 'wheel') await page.mouse.wheel(event.dx, event.dy);
        else if (event.type === 'key') await page.keyboard.press(event.key);
        else if (event.type === 'navigate' && page.url() !== event.url) await page.goto(event.url, { timeout: 30000 });
        else if (event.type === 'newPage') { const opened = await ctx.newPage(); if (s.state !== 'active') { await opened.close(); return; } if (safeNavigation(event.url)) await opened.goto(event.url, { timeout: 30000 }).catch(() => {}); }
      } catch { s.errors++; }
    }));
  }

  async function attachLeaderPage(s, ctx, page) {
    if (s.state !== 'active') return;
    const install = () => page.evaluate(capture, s.id).catch(() => {});
    page.on('domcontentloaded', install);
    const timers = new Set();
    const onNav = frame => {
      if (frame !== page.mainFrame() || s.state !== 'active') return;
      const url = frame.url();
      if (!safeNavigation(url)) return;
      // Give followers a moment to reach the same page through the mirrored click first.
      const timer = setTimeout(() => {
        timers.delete(timer);
        mirror(s, { type: 'navigate', url, pageIndex: Math.max(0, ctx.pages().indexOf(page)) }).catch(() => {});
      }, 800);
      timers.add(timer);
    };
    page.on('framenavigated', onNav);
    const detach = () => {
      page.off('framenavigated', onNav);
      page.off('close', detach);
      page.off('domcontentloaded', install);
      page.evaluate(id => {
        const active = window.__azwahSyncInstalled;
        if (active?.id === id) {
          active.controller.abort();
          delete window.__azwahSyncInstalled;
        }
      }, s.id).catch(() => {});
      timers.forEach(clearTimeout);
      s.cleanup.delete(detach);
    };
    page.once('close', detach);
    s.cleanup.add(detach);
    await install();
  }

  async function start({ leaderId, followerIds }) {
    if (typeof leaderId !== 'string' || !Array.isArray(followerIds)) throw err(400, 'leaderId and followerIds are required', 'SYNC_INVALID');
    const followers = [...new Set(followerIds.filter(id => typeof id === 'string'))];
    if (!followers.length) throw err(400, 'Select at least one follower profile', 'SYNC_INVALID');
    if (followers.length > MAX_FOLLOWERS) throw err(400, `At most ${MAX_FOLLOWERS} follower profiles`, 'SYNC_INVALID');
    if (followers.includes(leaderId)) throw err(400, 'The leader cannot also be a follower', 'SYNC_INVALID');
    for (const id of [leaderId, ...followers]) {
      if (!isRunning(id)) throw err(409, `${profileName(id)} is not running`, 'SYNC_NOT_RUNNING');
      if (!liveContext(id)) throw err(409, `${profileName(id)} runs without a browser context this app controls (native Chromium or Firefox). Synchronization supports the default Chromium and Chrome Stable runtimes only.`, 'SYNC_UNSUPPORTED_RUNTIME');
      if (memberOf.has(id)) throw err(409, `${profileName(id)} is already in a synchronization session`, 'SYNC_BUSY');
    }
    const s = { id: randomUUID(), leaderId, followerIds: new Set(followers), state: 'active', startedAt: new Date(now()).toISOString(), counts: {}, errors: 0, cleanup: new Set() };
    sessions.set(s.id, s);
    for (const id of [leaderId, ...followers]) memberOf.set(id, s.id);
    const ctx = liveContext(leaderId);
    for (const member of [leaderId, ...followers]) {
      const participant = liveContext(member);
      const onClose = () => stop(s.id, member === leaderId ? 'leader closed' : 'follower closed');
      participant.on('close', onClose);
      s.cleanup.add(() => participant.off('close', onClose));
    }
    if (!prepared.has(ctx)) {
      const setup = ctx.exposeBinding(BINDING, (source, event) => {
        const cur = activeFor(leaderId);
        if (!cur || cur.id !== event?.sessionId || liveContext(leaderId) !== ctx || !['click', 'wheel', 'key'].includes(event?.type)) return;
        const pageIndex = ctx.pages().indexOf(source.page);
        if (pageIndex >= 0) mirror(cur, { ...event, pageIndex }).catch(() => {});
      });
      prepared.set(ctx, setup);
    }
    try { await prepared.get(ctx); } catch {
      stop(s.id, 'leader attach failed');
      throw err(500, 'Could not attach to the leader profile', 'SYNC_ATTACH_FAILED');
    }
    if (s.state !== 'active') return summary(s);
    const onPage = page => {
      attachLeaderPage(s, ctx, page);
      mirror(s, { type: 'newPage', url: page.url() }).catch(() => {});
    };
    ctx.on('page', onPage);
    s.cleanup.add(() => ctx.off('page', onPage));
    for (const page of ctx.pages()) await attachLeaderPage(s, ctx, page);
    if (s.state !== 'active') return summary(s);
    emit('sync:started', leaderId, { sessionId: s.id, followers: followers.length });
    return summary(s);
  }

  function stop(id, reason = 'stopped') {
    const s = sessions.get(id);
    if (!s) return stopped.get(id) ?? null;
    s.state = 'stopped'; s.stopReason = reason; s.stoppedAt = new Date(now()).toISOString();
    for (const fn of s.cleanup) { try { fn(); } catch {} }
    for (const member of [s.leaderId, ...s.followerIds]) if (memberOf.get(member) === id) memberOf.delete(member);
    s.cleanup.clear();
    sessions.delete(id);
    stopped.set(id, summary(s));
    if (stopped.size > 64) stopped.delete(stopped.keys().next().value);
    emit('sync:stopped', s.leaderId, { sessionId: id, reason });
    return summary(s);
  }

  // Called when any profile stops: ends the session it belonged to.
  function profileStopped(profileId) {
    const id = memberOf.get(profileId);
    if (id) stop(id, `${profileName(profileId)} stopped`);
  }

  return {
    start, stop, profileStopped,
    shutdown: () => { for (const id of sessions.keys()) stop(id, 'server shutdown'); },
    list: () => [...sessions.values()].filter(s => s.state === 'active').map(summary),
    get: id => (sessions.has(id) ? summary(sessions.get(id)) : stopped.get(id) ?? null),
  };
}
