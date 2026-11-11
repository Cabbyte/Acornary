import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { reviewFeedbackServer } from '../feedback/server';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss(), reviewFeedbackServer()],
  publicDir: false,
  server: { host: '127.0.0.1', port: 6008, strictPort: true },
  build: { outDir: '../../../../output/ui-trial', emptyOutDir: true },
});
