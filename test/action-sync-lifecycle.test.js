import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createActionSync } from '../server/action-sync.js';

test('stop during attachment, follower closure and repeated sessions release listeners', async () => {
  const leader = new EventEmitter(), follower = new EventEmitter(), page = new EventEmitter();
  const sync = createActionSync({ liveContext: id => id === 'a' ? leader : follower, isRunning: () => true });
  const start = () => sync.start({ leaderId: 'a', followerIds: ['b'] });
  const ready = Promise.withResolvers();
  leader.exposeBinding = () => ready.promise;
  leader.addInitScript = async () => {};
  leader.pages = () => [page];
  page.evaluate = async () => {};
  const pending = start();
  sync.profileStopped('a');
  ready.resolve();
  await pending;
  assert.equal(leader.listenerCount('page'), 0);
  assert.equal(page.listenerCount('framenavigated'), 0);
  let first;
  for (let i = 0; i < 80; i++) {
    const session = await start();
    first ??= session.id;
    follower.emit('close');
    assert.deepEqual(sync.list(), []);
    assert.equal(leader.listenerCount('page'), 0);
    assert.equal(page.listenerCount('framenavigated'), 0);
    assert.equal(follower.listenerCount('close'), 0);
    assert.equal(sync.get(session.id).state, 'stopped');
  }
  assert.equal(sync.get(first), null);
});
