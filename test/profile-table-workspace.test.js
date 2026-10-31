import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryProfiles } from '../server/profile-table.js';

test('profile-table filters by workspaceId', () => {
  const rows = [
    { id: 'a', name: 'A', tags: [], folder: '', notes: '', running: false, last_error: null, workspaceId: 'ws-1', proxyId: null },
    { id: 'b', name: 'B', tags: [], folder: '', notes: '', running: false, last_error: null, workspaceId: null, proxyId: null },
  ];
  const filtered = queryProfiles(rows, { workspaceId: 'ws-1', folder: '__all' });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].id, 'a');
});
