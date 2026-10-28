// Native ICU locale with Chromium's ordered --accept-lang. Playwright's locale
// option also installs a single-language UA override, so it cannot serve this path.
// New page targets pause before scripts execute. Commands use the existing pipe;
// this does not enable a CDP TCP port or replace any JavaScript navigator values.
export async function installRegionalLocale(context, locale, { onFailure = () => {} } = {}) {
  const root = await context.browser().newBrowserCDPSession();
  // Pinned playwright-core 1.64.1 bridge, like browsers.js browserProcess().
  // Public CDPSession cannot address flattened child sessions. Validate the narrow
  // adapter and fail closed if a future Playwright upgrade removes this capability.
  const parent = root._connection?.toImpl?.(root)?._session;
  if (typeof parent?.createChildSession !== 'function' || typeof parent?.disposeChildSession !== 'function' || typeof parent?.on !== 'function') {
    await root.detach().catch(() => {});
    throw new Error('Regional locale requires the pinned Playwright CDP session adapter');
  }
  const pending = new Set(), children = new Map();
  const filter = [{ type: 'page' }, { type: 'iframe' }, { exclude: true }];
  let startup = true, failure = null, closed = false;
  // M2 diagnostic exemption. Ownership is the exact targetId returned by this
  // module's own Target.createTarget call (never a URL match). Only a top-level
  // page's initial regional setup may fail without closing the profile; the
  // target is then left paused (never resumed) so it cannot run with the wrong
  // locale, and it is not closed (DiagnosticsV1 §7.9).
  const diagnosticCreates = new Set(), diagnosticTargets = new Map(), quarantined = new Set();
  const isDiagnostic = async targetId => {
    if (!targetId) return false;
    await Promise.allSettled([...diagnosticCreates]);
    return diagnosticTargets.has(targetId);
  };
  const settleDiagnostic = (targetId, error) => {
    const waiter = diagnosticTargets.get(targetId);
    if (!waiter) return;
    diagnosticTargets.delete(targetId);
    if (error) waiter.reject(error); else waiter.resolve();
  };
  const applyLocale = async child => {
    try {
      await child.send('Emulation.setLocaleOverride', { locale });
    } catch (error) {
      // Popups can share a renderer/ICU override with their opener (the
      // pinned Playwright locale adapter handles this same Chromium error).
      // Accept it only after independently observing the requested locale.
      if (!error.message.includes('Another locale override is already in effect')) throw error;
      const { result, exceptionDetails } = await child.send('Runtime.evaluate', {
        expression: '({ actual: Intl.DateTimeFormat().resolvedOptions().locale, expected: new Intl.DateTimeFormat(' + JSON.stringify(locale) + ').resolvedOptions().locale })',
        returnByValue: true,
      });
      if (exceptionDetails || !result.value || result.value.actual !== result.value.expected) throw error;
    }
  };
  const attach = (session, { sessionId, targetInfo }) => {
    const targetId = session === parent ? targetInfo?.targetId : undefined;
    const child = session.createChildSession(sessionId);
    children.set(sessionId, { parent: session, child });
    child.on('Target.attachedToTarget', event => attach(child, event));
    child.on('Target.detachedFromTarget', detach);
    const work = (async () => {
      try {
        await applyLocale(child);
        await child.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter });
        await child.send('Runtime.runIfWaitingForDebugger');
        if (diagnosticCreates.size || diagnosticTargets.size) void isDiagnostic(targetId).then(own => own && settleDiagnostic(targetId, null));
      } catch (error) {
        // A page closed during setup is no longer a target to configure.
        if (closed || !children.has(sessionId)) return;
        const cause = new Error('Failed to apply native browser regional locale', { cause: error });
        if (!startup && await isDiagnostic(targetId)) {
          if (closed || !children.has(sessionId)) return;
          quarantined.add(sessionId);
          settleDiagnostic(targetId, cause);
          return; // Keep paused: never resumed, never closed automatically.
        }
        failure ||= cause;
        if (!startup) {
          await context.close().catch(() => {});
          await onFailure(failure);
        }
        // Do not resume a target that failed regional setup.
      }
    })();
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };
  // ICU overrides are renderer-scoped. Closing the owner can clear a shared
  // renderer after the detach command has already been sent, so reclaim again
  // after Playwright's own close finishes and do not resolve that close first.
  const retainSurvivors = () => {
    if (closed) return Promise.resolve();
    const jobs = [];
    for (const [id, live] of children) {
      if (quarantined.has(id)) continue; // Paused target: no script can run in it.
      const work = applyLocale(live.child).catch(async error => {
        if (closed || !children.has(id)) return;
        failure ||= new Error('Failed to retain native browser regional locale', { cause: error });
        await context.close().catch(() => {});
        await onFailure(failure);
      });
      pending.add(work);
      jobs.push(work.finally(() => pending.delete(work)));
    }
    return Promise.all(jobs);
  };
  const detach = ({ sessionId }) => {
    const entry = children.get(sessionId);
    children.delete(sessionId);
    quarantined.delete(sessionId);
    entry?.parent.disposeChildSession(sessionId);
    void retainSurvivors();
  };
  const wrapped = new WeakSet(), closing = new WeakSet();
  const wrapClose = page => {
    if (!page || wrapped.has(page) || typeof page.close !== 'function') return;
    wrapped.add(page);
    const orig = page.close;
    page.close = async function(options) {
      if (closing.has(page)) return orig.call(this, options);
      closing.add(page);
      try {
        const result = await orig.call(this, options);
        if (!closed) {
          while (pending.size) await Promise.all([...pending]);
          if (!closed && !failure) await retainSurvivors();
        }
        if (failure) throw failure;
        return result;
      } finally {
        closing.delete(page);
      }
    };
  };
  if (typeof context.on === 'function') context.on('page', wrapClose);
  if (typeof context.pages === 'function') for (const page of context.pages()) wrapClose(page);
  const onAttach = event => attach(parent, event);
  // In-process detach starts reclaim before the client close event. Page.close
  // still waits until a post-teardown reclaim finishes, which the event order
  // alone does not guarantee.
  parent.on('Target.attachedToTarget', onAttach);
  parent.on('Target.detachedFromTarget', detach);
  context.once('close', () => {
    closed = true;
    parent.removeListener('Target.attachedToTarget', onAttach);
    parent.removeListener('Target.detachedFromTarget', detach);
    for (const sessionId of [...children.keys()]) detach({ sessionId });
    for (const targetId of [...diagnosticTargets.keys()]) settleDiagnostic(targetId, new Error('Browser closed'));
  });
  await root.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter });
  // Flush initial attach events before considering the launch configured.
  await root.send('Target.getTargets');
  while (pending.size) await Promise.all([...pending]);
  startup = false;
  if (failure) throw failure;
  return {
    // Server-internal only. Creates one app-owned page target and resolves once
    // its native regional setup succeeded; rejects if that setup failed.
    async createDiagnosticTarget() {
      if (closed || failure) throw new Error('Regional locale unavailable');
      let waiter;
      const ready = new Promise((resolve, reject) => { waiter = { resolve, reject }; });
      ready.catch(() => {});
      const creation = root.send('Target.createTarget', { url: 'about:blank' })
        .then(({ targetId }) => { if (closed) waiter.reject(new Error('Browser closed')); else diagnosticTargets.set(targetId, waiter); return targetId; });
      diagnosticCreates.add(creation);
      try {
        return { targetId: await creation, ready };
      } finally {
        diagnosticCreates.delete(creation);
      }
    },
  };
}
