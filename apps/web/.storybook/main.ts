import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';
import { reviewFeedbackServer } from '../review/feedback/server';
const config: StorybookConfig = {
  stories: ['../review/**/*.stories.tsx'],
  framework: {
    name: '@storybook/react-vite',
    options: { builder: { viteConfigPath: 'apps/web/.storybook/vite.config.ts' } },
  },
  core: { disableTelemetry: true },
  async viteFinal(config) {
    config.plugins = [...(config.plugins ?? []), tailwindcss(), reviewFeedbackServer()];
    config.server = { ...config.server, host: '127.0.0.1', proxy: {} };
    config.publicDir = false;
    return config;
  },
};
export default config;
