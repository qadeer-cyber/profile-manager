// Live dashboard counts. Every number is a database aggregate or the process's
// running-profile set. Nothing here is a sample or a placeholder.
import { db } from './db.js';
import { runningIds, runInfo, resourceSnapshot } from './browsers.js';
import { currentVersion } from './migrations.js';

export function dashboardStats() {
  const profiles = db.prepare('SELECT id, name, last_error, automation_enabled, proxy_id, updated_at FROM profiles WHERE deleted_at IS NULL').all();
  const live = new Set(runningIds());
  const proxies = db.prepare('SELECT id, last_test_status FROM proxies').all();
  const assigned = new Set(profiles.map(profile => profile.proxy_id).filter(Boolean));
  const errors = profiles
    .filter(profile => profile.last_error)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 20)
    .map(profile => ({ id: profile.id, name: profile.name, message: profile.last_error, at: profile.updated_at }));
  const resources = resourceSnapshot();
  const memoryById = new Map(resources.browsers.profiles.map(row => [row.id, row.memoryMiB]));
  const sessions = [...live].map(id => {
    const info = runInfo(id);
    const profile = profiles.find(row => row.id === id);
    return {
      id,
      name: profile?.name || null,
      pid: info?.pid ?? null,
      startedAt: info?.started_at ?? null,
      automation: !!info?.cdp_port,
      memoryMiB: memoryById.get(id) ?? null,
    };
  });
  const countStatus = status => proxies.filter(proxy => proxy.last_test_status === status).length;
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: currentVersion(db),
    profiles: {
      total: profiles.length,
      running: live.size,
      stopped: profiles.length - live.size,
      withError: profiles.filter(profile => profile.last_error).length,
      automationEnabled: profiles.filter(profile => profile.automation_enabled).length,
    },
    proxies: {
      total: proxies.length,
      ok: countStatus('ok'),
      failed: countStatus('failed'),
      untested: proxies.filter(proxy => !proxy.last_test_status).length,
      assigned: assigned.size,
    },
    sessions,
    errors,
    extensions: db.prepare('SELECT COUNT(*) n FROM extensions').get().n,
    resources: {
      host: resources.host,
      totalBrowserMemoryMiB: resources.browsers.totalBrowserMemoryMiB,
      queue: resources.queue,
    },
  };
}
