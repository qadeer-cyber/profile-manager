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
  const attach = (session, { sessionId }) => {
    const child = session.createChildSession(sessionId);
    children.set(sessionId, { parent: session, child });
    child.on('Target.attachedToTarget', event => attach(child, event));
    child.on('Target.detachedFromTarget', detach);
    const work = (async () => {
      try {
        await applyLocale(child);
        await child.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter });
        await child.send('Runtime.runIfWaitingForDebugger');
      } catch (error) {
        // A page closed during setup is no longer a target to configure.
        if (closed || !children.has(sessionId)) return;
        failure ||= new Error('Failed to apply native browser regional locale', { cause: error });
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
  const detach = ({ sessionId }) => {
    const entry = children.get(sessionId);
    children.delete(sessionId);
    entry?.parent.disposeChildSession(sessionId);
    // ICU overrides are renderer-scoped. If the owner page closes, reclaim
    // the override for surviving popups before their next navigation.
    if (!closed) for (const [id, live] of children) {
      const work = applyLocale(live.child).catch(async error => {
        if (closed || !children.has(id)) return;
        failure ||= new Error('Failed to retain native browser regional locale', { cause: error });
        await context.close().catch(() => {});
        await onFailure(failure);
      });
      pending.add(work);
      void work.finally(() => pending.delete(work));
    }
  };
  const onAttach = event => attach(parent, event);
  // Handle renderer teardown on the in-process protocol session before the
  // client page-close event is dispatched; the public event bridge adds a race.
  parent.on('Target.attachedToTarget', onAttach);
  parent.on('Target.detachedFromTarget', detach);
  context.once('close', () => {
    closed = true;
    parent.removeListener('Target.attachedToTarget', onAttach);
    parent.removeListener('Target.detachedFromTarget', detach);
    for (const sessionId of [...children.keys()]) detach({ sessionId });
  });
  await root.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter });
  // Flush initial attach events before considering the launch configured.
  await root.send('Target.getTargets');
  while (pending.size) await Promise.all([...pending]);
  startup = false;
  if (failure) throw failure;
}
