import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [
    react(),
    {
      name: 'acornary-mcp-resource',
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          const js = Object.values(bundle)
            .filter((x) => x.type === 'chunk')
            .map((x) => x.code)
            .join('\n');
          const css = Object.values(bundle)
            .flatMap((x) =>
              x.type === 'asset' && x.fileName.endsWith('.css') ? [String(x.source)] : [],
            )
            .join('\n');
          this.emitFile({
            type: 'asset',
            fileName: 'index.html',
            source: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>松仓库存</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`,
          });
        },
      },
    },
  ],
  build: {
    outDir: 'dist/plugin',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/plugin.tsx',
      name: 'AcornaryInventory',
      formats: ['iife'],
      fileName: () => 'app.js',
    },
  },
});
