import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { connectMarionette } from './_marionette-client.mjs';

test('Marionette test client handles split length frames, IDs, protocol errors and quit disconnect', { timeout: 5000 }, async t => {
  const sockets = new Set();
  const frame = value => { const b = Buffer.from(JSON.stringify(value)); return Buffer.concat([Buffer.from(b.length + ':'), b]); };
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    const greeting = frame({ applicationType: 'gecko', marionetteProtocol: 3 }); socket.write(greeting.subarray(0, 3)); socket.write(greeting.subarray(3));
    let buffer = Buffer.alloc(0);
    socket.on('data', b => {
      buffer = Buffer.concat([buffer, b]);
      while (true) {
        const i = buffer.indexOf(58); if (i < 0) return; const n = Number(buffer.subarray(0, i)); if (buffer.length < i + n + 1) return;
        const command = JSON.parse(buffer.subarray(i + 1, i + 1 + n)); buffer = buffer.subarray(i + n + 1);
        if (command[2] === 'Marionette:Quit') socket.end();
        else socket.write(frame([1, command[1], command[2] === 'fail' ? { error: 'invalid argument', message: 'fixture error' } : null, { value: 'مرحبا' }]));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { for (const s of sockets) s.destroy(); server.close(resolve); }));
  const client = await connectMarionette(server.address().port, 1000); t.after(() => client.close());
  assert.deepEqual(await client.command('WebDriver:ExecuteScript', {}), { value: 'مرحبا' });
  await assert.rejects(() => client.command('fail'), /fixture error/);
  await assert.rejects(() => client.command('Marionette:Quit'), /connection closed/);
});
