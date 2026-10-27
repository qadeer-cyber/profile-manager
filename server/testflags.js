// Dev/test switches. A packaged app overwrites PM_PACKAGED from app.isPackaged and then
// ignores these three, even if the process inherited them. PM_SMOKE is not one of them.

export function applyPackagedFlag(env, packaged) {
  env.PM_PACKAGED = packaged ? '1' : '0';
}

export function isPackaged(env = process.env) {
  return env.PM_PACKAGED === '1';
}

function flag(env, name) {
  return !isPackaged(env) && env[name] === '1';
}

export function automationDefault(env = process.env) {
  return flag(env, 'PM_AUTOMATION_DEFAULT');
}
export function proxyLoopback(env = process.env) {
  return flag(env, 'PM_PROXY_LOOPBACK');
}
export function proxyTestInsecureTls(env = process.env) {
  return flag(env, 'PM_PROXY_TEST_INSECURE_TLS');
}
