// Cross-platform (cmd.exe-safe) wrapper: runs a legacy CDP e2e suite with automation on by default.
import { spawnSync } from 'child_process';
const r = spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit', env: { ...process.env, PM_AUTOMATION_DEFAULT: '1' } });
process.exit(r.status ?? 1);
