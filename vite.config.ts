import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function sourceRevision() {
  const hash = createHash('sha256');
  function visit(path: string) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(tsx?|css)$/.test(file) && !file.endsWith('.test.ts')) hash.update(file).update(readFileSync(file));
    }
  }
  visit('src');
  return hash.update(readFileSync('index.html')).update(readFileSync('vite.config.ts')).digest('hex');
}

export default defineConfig(() => ({
  define: { __PITCH_REVISION__: JSON.stringify(sourceRevision()) },
  base: './',
  plugins: [react(), {
    name: 'reset-layout-on-app-change',
    async handleHotUpdate({ file, server }) {
      if (/[\\/]src[\\/].*\.(tsx?|css)$/.test(file) && !file.endsWith('.test.ts')) {
        await server.restart();
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  }],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
