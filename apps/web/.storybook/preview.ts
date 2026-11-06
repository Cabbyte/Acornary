import type { Preview } from '@storybook/react-vite';
import { createElement } from 'react';
import { useGlobals } from 'storybook/preview-api';
import { ReviewAppearanceProvider } from '../review/appearance-context';
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
    (Story) => {
      const [globals, updateGlobals] = useGlobals();
      const preset = globals.preset as AppearancePreset;
      const mode = globals.mode as UIMode;
      return createElement(AcornaryThemeProvider, {
        preset,
        mode,
        children: createElement(ReviewAppearanceProvider, {
          value: {
            preset,
            mode,
            onPresetChange: (next) => updateGlobals({ preset: next }),
            onModeChange: (next) => updateGlobals({ mode: next }),
          },
          children: createElement(Story),
        }),
      });
    },
  ],
};
export default preview;
