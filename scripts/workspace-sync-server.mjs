// Explicitly started, self-hosted TLS relay. No cloud deployment or paid service.
import fs from 'node:fs';
import { createWorkspaceSyncService } from '../server/workspace-sync-service.js';
const configPath = process.env.PM_SYNC_CONFIG;
if (!configPath) throw Error('PM_SYNC_CONFIG must name a local config file with directory, keyFile, certFile, principals and optional host/port');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const server = createWorkspaceSyncService({ ...config, key: fs.readFileSync(config.keyFile), cert: fs.readFileSync(config.certFile) });
server.listen(config.port || 7443, config.host || '127.0.0.1', () => console.log('Encrypted workspace relay ready'));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close());
