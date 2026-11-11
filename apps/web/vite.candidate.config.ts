import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// A separate source artifact; never writes to Worker ASSETS or plugin resources.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: false,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'candidate-source-boundary',
      generateBundle(_options, bundle) {
        for (const entry of Object.values(bundle)) {
          if (entry.type !== 'chunk') continue;
          for (const id of Object.keys(entry.modules)) {
            if (
              /[/\\](?:review|\.storybook|fixtures)[/\\]|node_modules[/\\](?:antd|@ant-design)[/\\]/.test(
                id,
              )
            ) {
              this.error(`Development or legacy UI module in candidate: ${id}`);
            }
          }
        }
      },
    },
  ],
  build: {
    outDir: '../../output/ui-candidate',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: 'src/candidate.ts', formats: ['es'], fileName: 'acornary-candidate' },
    rolldownOptions: { external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'] },
  },
});
