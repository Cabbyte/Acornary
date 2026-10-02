import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    react(),
    {
      name: 'acornary-offline-shell',
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          const assets = Object.keys(bundle)
            .filter(
              (name) =>
                /\.(js|css|png|svg)$/.test(name) &&
                !/^assets\/(inspector|authentication)-/.test(name),
            )
            .map((name) => `/${name}`);
          const version = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);
          const source = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8')
            .replace('__VERSION__', version)
            .replace('__PRECACHE__', JSON.stringify(assets));
          this.emitFile({ type: 'asset', fileName: 'sw.js', source });
        },
      },
    },
  ],
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:3210' } },
  build: { outDir: 'dist' },
});
