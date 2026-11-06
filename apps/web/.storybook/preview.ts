import type { Preview } from '@storybook/react-vite';
import { createElement } from 'react';
import {
  AcornaryThemeProvider,
  type AppearancePreset,
  type UIMode,
} from '../src/ui/theme/provider';
const preview: Preview = {
  parameters: { layout: 'padded', controls: { expanded: true } },
  globalTypes: {
    preset: {
      description: '配色',
      toolbar: {
        icon: 'paintbrush',
        items: [
          { value: 'sage', title: '苔绿与石板蓝' },
          { value: 'apricot', title: '杏橙与靛蓝' },
          { value: 'berry', title: '莓紫与青灰' },
          { value: 'terracotta', title: '陶土与蓝灰' },
        ],
      },
    },
    mode: {
      description: '模式',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'daily', title: '日常' },
          { value: 'management', title: '管理' },
        ],
      },
    },
  },
  initialGlobals: { preset: 'sage', mode: 'daily' },
  decorators: [
    (Story, context) =>
      createElement(AcornaryThemeProvider, {
        preset: context.globals.preset as AppearancePreset,
        mode: context.globals.mode as UIMode,
        children: createElement(Story),
      }),
  ],
};
export default preview;
