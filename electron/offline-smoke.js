// Packaged offline-install smoke. Loaded only when PM_SMOKE=1 and PM_SMOKE_OFFLINE=1.
// The bad-certificate HTTPS server is started by the Windows harness; this file only
// receives its port. No key or certificate material lives here.
import fs from 'fs';
import { app } from 'electron';
import { selectSmokePhase, dispatchSmokePhase, phaseHandlers, createSmokeContext, commonSmokeFacts } from './smoke-phases.js';

export async function runOfflineSmoke({ backend, win, uiToken, userData, log }) {
  if (process.env.PM_SMOKE !== '1' || process.env.PM_SMOKE_OFFLINE !== '1') {
    throw new Error('offline smoke requires PM_SMOKE=1 and PM_SMOKE_OFFLINE=1');
  }
  let phase;
  try { phase = selectSmokePhase(process.env.PM_SMOKE_PHASE); }
  catch (err) {
    log(err.message);
    if (process.env.PM_SMOKE_RESULT) fs.writeFileSync(process.env.PM_SMOKE_RESULT, JSON.stringify({ phase: process.env.PM_SMOKE_PHASE ?? null, error: err.message }, null, 2));
    app.exit(1);
    return;
  }
  const ctx = createSmokeContext({ backend, win, uiToken, userData, log });
  const r = { phase };
  try {
    Object.assign(r, await commonSmokeFacts(ctx));
    Object.assign(r, await dispatchSmokePhase(phase, phaseHandlers(ctx)));
  } catch (err) {
    r.error = String(err && err.stack || err);
    log('offline smoke error', err);
  }
  fs.writeFileSync(process.env.PM_SMOKE_RESULT, JSON.stringify(r, null, 2));
  app.quit();
}
