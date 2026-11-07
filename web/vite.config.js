import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const admin = process.env.VITE_AZWAH_ADMIN === '1';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@azwah-admin': path.resolve(admin ? 'web/src/license-admin-entry.js' : 'web/src/license-admin-absent.js') } },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
