// Proxy library helpers: tag groups, measurable health analytics (no invented bandwidth).
import { db } from './db.js';
import { TRAFFIC_SAVINGS_NOTE, trafficMeasurementSummary } from './proxy-traffic.js';

export const PROXY_ANALYTICS_NOTE = 'Statistics are from local proxy_checks rows and profile assignment counts only. Provider usage requires an explicit Usage API call per account.';

export function proxyTagGroups() {
  const rows = db.prepare('SELECT tags, last_test_status FROM proxies').all();
  const map = new Map();
  for (const row of rows) {
    const tags = JSON.parse(row.tags || '[]');
    const buckets = tags.length ? tags : ['_untagged'];
    for (const tag of buckets) {
      if (!map.has(tag)) map.set(tag, { tag, count: 0, ok: 0, failed: 0, untested: 0 });
      const g = map.get(tag);
      g.count += 1;
      if (row.last_test_status === 'ok') g.ok += 1;
      else if (row.last_test_status === 'failed') g.failed += 1;
      else g.untested += 1;
    }
  }
  return [...map.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

export function proxyHealthAnalytics() {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
           AVG(CASE WHEN status = 'ok' THEN latency_ms END) AS avgOkLatencyMs,
           SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS okCount,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failCount
    FROM proxy_checks
    WHERE tested_at >= datetime('now', '-7 days')`).get();
  const profilesDirect = db.prepare('SELECT COUNT(*) n FROM profiles WHERE proxy_id IS NULL AND deleted_at IS NULL').get().n;
  const profilesAssigned = db.prepare('SELECT COUNT(*) n FROM profiles WHERE proxy_id IS NOT NULL AND deleted_at IS NULL').get().n;
  const measured = trafficMeasurementSummary();
  return {
    note: PROXY_ANALYTICS_NOTE,
    checksLast7Days: row?.total || 0,
    okChecksLast7Days: row?.okCount || 0,
    failedChecksLast7Days: row?.failCount || 0,
    avgOkLatencyMs: row?.avgOkLatencyMs != null ? Math.round(row.avgOkLatencyMs) : null,
    profilesDirect,
    profilesAssigned,
    trafficSaverSupported: false,
    measuredHttpSavingsSupported: true,
    httpsConnectBlocking: false,
    measuredTrafficSessions: measured.sessions,
    trafficNote: TRAFFIC_SAVINGS_NOTE,
  };
}

export function assertNotPausedTemplate(tags) {
  if (tags.includes('paused')) {
    throw Object.assign(new Error('This proxy is marked paused and cannot be assigned. Remove the paused tag or pick another proxy.'), { status: 409, code: 'PROXY_PAUSED' });
  }
  if (tags.includes('template')) {
    throw Object.assign(new Error('Templates are presets only. Instantiate a live proxy from the template first.'), { status: 409, code: 'PROXY_TEMPLATE' });
  }
}
