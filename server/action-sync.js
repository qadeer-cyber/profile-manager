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
const CAPTURE = `(() => {
  if (window.__azwahSyncInstalled) return; window.__azwahSyncInstalled = true;
  const send = e => { try { window.${BINDING} && window.${BINDING}(e); } catch {} };
  const isSecret = t => t && t.closest && t.closest('input[type="password"]');
  addEventListener('click', ev => { if (!ev.isTrusted) return; send({ type: 'click', x: ev.clientX / innerWidth, y: ev.clientY / innerHeight, button: ev.button }); }, true);
  addEventListener('wheel', ev => { if (!ev.isTrusted) return; send({ type: 'wheel', dx: ev.deltaX, dy: ev.deltaY }); }, { capture: true, passive: true });
  addEventListener('keydown', ev => {
    if (!ev.isTrusted || ev.isComposing || isSecret(ev.target)) return;
    const mods = [ev.ctrlKey && 'Control', ev.altKey && 'Alt', ev.metaKey && 'Meta', ev.shiftKey && ev.key.length > 1 && 'Shift'].filter(Boolean);
    send({ type: 'key', key: [...mods, ev.key].join('+') });
  }, true);
})();`;

const err = (status, message, code) => Object.assign(new Error(message), { status, code });

export function createActionSync({ liveContext, isRunning, profileName = id => id, emit = () => {}, now = () => Date.now() }) {
  const sessions = new Map();
  const memberOf = new Map();
  const prepared = new WeakSet(); // browser contexts that already have the binding and capture script
  const activeFor = leaderId => { const cur = sessions.get(memberOf.get(leaderId)); return cur && cur.state === 'active' && cur.leaderId === leaderId ? cur : null; };

  const summary = s => ({ id: s.id, leaderId: s.leaderId, followerIds: [...s.followerIds], state: s.state, startedAt: s.startedAt,
    stoppedAt: s.stoppedAt || null, stopReason: s.stopReason || null, mirrored: { ...s.counts }, errors: s.errors });

  async function mirror(s, event) {
    if (s.state !== 'active') return;
    s.counts[event.type] = (s.counts[event.type] || 0) + 1;
    await Promise.all([...s.followerIds].map(async id => {
      const ctx = liveContext(id);
      if (!ctx) return stop(s.id, `follower ${profileName(id)} is no longer running`);
      const page = ctx.pages()[event.pageIndex ?? 0] || ctx.pages()[0];
      if (!page) return;
      try {
        if (event.type === 'click') {
          const size = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
          await page.mouse.click(Math.round(event.x * size.width), Math.round(event.y * size.height), { button: ['left', 'middle', 'right'][event.button] || 'left' });
        } else if (event.type === 'wheel') await page.mouse.wheel(event.dx, event.dy);
        else if (event.type === 'key') await page.keyboard.press(event.key);
        else if (event.type === 'navigate' && page.url() !== event.url) await page.goto(event.url, { timeout: 30000 });
        else if (event.type === 'newPage') { const opened = await ctx.newPage(); if (event.url && event.url !== 'about:blank') await opened.goto(event.url, { timeout: 30000 }).catch(() => {}); }
      } catch { s.errors++; }
    }));
  }

  async function attachLeaderPage(s, ctx, page) {
    const onNav = frame => {
      if (frame !== page.mainFrame() || s.state !== 'active') return;
      const url = frame.url();
      if (!/^https?:/.test(url)) return;
      // Give followers a moment to reach the same page through the mirrored click first.
      setTimeout(() => mirror(s, { type: 'navigate', url, pageIndex: Math.max(0, ctx.pages().indexOf(page)) }).catch(() => {}), 800);
    };
    page.on('framenavigated', onNav);
    s.cleanup.push(() => page.off('framenavigated', onNav));
    await page.evaluate(CAPTURE).catch(() => {});
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
    const s = { id: randomUUID(), leaderId, followerIds: new Set(followers), state: 'active', startedAt: new Date(now()).toISOString(), counts: {}, errors: 0, cleanup: [] };
    sessions.set(s.id, s);
    for (const id of [leaderId, ...followers]) memberOf.set(id, s.id);
    const ctx = liveContext(leaderId);
    if (!prepared.has(ctx)) {
      // Registered once per browser context (Playwright allows one binding per name). Each event is
      // routed to whichever session this leader is in *now*, so later sessions work and stopped
      // sessions receive nothing.
      try {
        await ctx.exposeBinding(BINDING, (source, event) => {
          const cur = activeFor(leaderId);
          if (!cur || !event || typeof event !== 'object' || !['click', 'wheel', 'key'].includes(event.type)) return;
          const pageIndex = ctx.pages().indexOf(source.page);
          mirror(cur, { ...event, pageIndex: pageIndex < 0 ? 0 : pageIndex }).catch(() => {});
        });
        await ctx.addInitScript(CAPTURE);
        prepared.add(ctx);
      } catch {
        stop(s.id, 'leader attach failed');
        throw err(500, 'Could not attach to the leader profile', 'SYNC_ATTACH_FAILED');
      }
    }
    for (const page of ctx.pages()) await attachLeaderPage(s, ctx, page);
    const onPage = page => { if (s.state !== 'active') return; attachLeaderPage(s, ctx, page); mirror(s, { type: 'newPage', url: page.url() }).catch(() => {}); };
    ctx.on('page', onPage);
    const onClose = () => stop(s.id, 'leader closed');
    ctx.on('close', onClose);
    s.cleanup.push(() => { ctx.off('page', onPage); ctx.off('close', onClose); });
    emit('sync:started', leaderId, { sessionId: s.id, followers: followers.length });
    return summary(s);
  }

  function stop(id, reason = 'stopped') {
    const s = sessions.get(id);
    if (!s || s.state !== 'active') return s ? summary(s) : null;
    s.state = 'stopped'; s.stopReason = reason; s.stoppedAt = new Date(now()).toISOString();
    for (const fn of s.cleanup) { try { fn(); } catch {} }
    for (const member of [s.leaderId, ...s.followerIds]) if (memberOf.get(member) === id) memberOf.delete(member);
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
    list: () => [...sessions.values()].filter(s => s.state === 'active').map(summary),
    get: id => (sessions.has(id) ? summary(sessions.get(id)) : null),
  };
}
