// Bounded loopback client for Mozilla's documented length-prefixed Marionette v3 protocol.
import net from 'node:net';
export async function connectMarionette(port, timeoutMs = 15000) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid Marionette port');
  const deadline = Date.now() + timeoutMs;
  let socket;
  while (Date.now() < deadline) {
    try {
      socket = await new Promise((resolve, reject) => {
        const s = net.connect({ host: '127.0.0.1', port });
        s.setTimeout(Math.min(1000, Math.max(1, deadline - Date.now())), () => s.destroy(Error('Marionette connect timeout')));
        s.once('connect', () => { s.setTimeout(0); s.off('error', reject); resolve(s); });
        s.once('error', error => { s.destroy(); reject(error); });
      }); break;
    } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!socket) throw Error('Firefox Marionette did not become ready on its selected port');
  let buffer = Buffer.alloc(0), id = 0, greetingDone = false, greetingResolve, greetingReject;
  const pending = new Map();
  const greeting = new Promise((resolve, reject) => { greetingResolve = resolve; greetingReject = reject; });
  const fail = error => { greetingReject(error); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  socket.on('error', fail); socket.on('close', () => fail(Error('Marionette connection closed')));
  socket.on('data', chunk => {
    try {
      buffer = Buffer.concat([buffer, chunk]); if (buffer.length > 2 * 1024 * 1024) throw Error('Marionette response exceeded bounds');
      while (true) {
        const colon = buffer.indexOf(58); if (colon < 0) { if (buffer.length > 12) throw Error('Invalid Marionette frame'); return; }
        const lengthText = buffer.subarray(0, colon).toString(); if (!/^\d{1,10}$/.test(lengthText)) throw Error('Invalid Marionette frame');
        const size = Number(lengthText); if (size > 2 * 1024 * 1024) throw Error('Oversized Marionette response');
        if (buffer.length < colon + 1 + size) return;
        const message = JSON.parse(buffer.subarray(colon + 1, colon + 1 + size)); buffer = buffer.subarray(colon + 1 + size);
        if (!greetingDone) { if (message.marionetteProtocol !== 3) throw Error('Unsupported Marionette protocol'); greetingDone = true; greetingResolve(); continue; }
        if (!Array.isArray(message) || message.length !== 4 || message[0] !== 1 || !Number.isInteger(message[1])) throw Error('Invalid Marionette response');
        const p = pending.get(message[1]); if (!p) continue;
        clearTimeout(p.timer); pending.delete(message[1]);
        if (message[2]) p.reject(Error(message[2].message || message[2].error)); else p.resolve(message[3]);
      }
    } catch (error) { fail(error); socket.destroy(); }
  });
  let greetingTimer;
  try { await Promise.race([greeting, new Promise((_, reject) => { greetingTimer = setTimeout(() => reject(Error('Marionette greeting timed out')), 5000); })]); }
  catch (error) { socket.destroy(); throw error; } finally { clearTimeout(greetingTimer); }
  return {
    command(name, params = {}) {
      if (socket.destroyed) return Promise.reject(Error('Marionette connection closed'));
      if (pending.size >= 8) return Promise.reject(Error('Marionette command limit reached'));
      const next = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(next); reject(Error(`Marionette ${name} timed out`)); socket.destroy(); }, timeoutMs);
        pending.set(next, { resolve, reject, timer });
        const payload = Buffer.from(JSON.stringify([0, next, name, params])); socket.write(Buffer.concat([Buffer.from(payload.length + ':'), payload]));
      });
    },
    close() { socket.destroy(); },
  };
}
