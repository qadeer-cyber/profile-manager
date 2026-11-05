// Bounded loopback WebDriver BiDi transport. No page scripts are patched.
export async function connectFirefoxBidi(port, timeoutMs = 15000) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid Firefox BiDi port');
  const deadline = Date.now() + timeoutMs;
  let socket;
  while (Date.now() < deadline) {
    try {
      socket = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
        const timer = setTimeout(() => { ws.close(); reject(Error('Firefox BiDi connection timeout')); }, 1000);
        ws.addEventListener('open', () => { clearTimeout(timer); resolve(ws); }, { once: true });
        ws.addEventListener('error', () => { clearTimeout(timer); reject(Error('Firefox BiDi connection failed')); }, { once: true });
      });
      break;
    } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!socket) throw Error('Firefox BiDi did not become ready');
  let sequence = 0;
  const pending = new Map();
  const fail = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
  socket.addEventListener('close', () => fail(Error('Firefox BiDi connection closed')));
  socket.addEventListener('error', () => fail(Error('Firefox BiDi transport failed')));
  socket.addEventListener('message', event => {
    try {
      if (typeof event.data !== 'string' || event.data.length > 2 * 1024 * 1024) throw Error('Invalid Firefox BiDi response');
      const response = JSON.parse(event.data), item = pending.get(response.id);
      if (!item) return;
      clearTimeout(item.timer); pending.delete(response.id);
      if (response.type === 'error') item.reject(Error(`Firefox BiDi ${response.error}: ${response.message}`));
      else item.resolve(response.result);
    } catch (error) { fail(error); socket.close(); }
  });
  return {
    command(method, params = {}) {
      if (socket.readyState !== WebSocket.OPEN || pending.size >= 16) return Promise.reject(Error('Firefox BiDi unavailable'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`Firefox BiDi ${method} timeout`)); socket.close(); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { fail(Error('Firefox BiDi closed by caller')); socket.close(); },
  };
}
export async function setFirefoxTimezone(client, timezone) {
  // ICU validates the IANA identifier in Firefox. The default user context covers
  // new tabs and their child frames and workers within this one browser process.
  return client.command('emulation.setTimezoneOverride', { timezone, userContexts: ['default'] });
}
