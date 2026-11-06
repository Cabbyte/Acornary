import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReviewDemoProps } from '../types';
import {
  compositionEntries,
  SearchComposition,
  FormComposition,
  OperationComposition,
  ManagementComposition,
  ShellComposition,
} from './compositions-demos';
const meta = {
  id: 'rc1-compositions',
  title: 'RC1/组合场景',
  parameters: { layout: 'padded' },
} satisfies Meta<ReviewDemoProps>;
export default meta;
type Story = StoryObj<ReviewDemoProps>;
function settings(id: string) {
  const entry = compositionEntries.find((e) => e.id === id)!;
  return {
    args: { scenario: entry.scenarios[0].id },
    argTypes: {
      scenario: {
        options: entry.scenarios.map((s) => s.id),
        control: {
          type: 'select' as const,
          labels: Object.fromEntries(entry.scenarios.map((s) => [s.id, s.label])),
        },
      },
    },
  };
}
export const Search: Story = {
  ...settings('composition-search'),
  name: '搜索与物品列表',
  render: SearchComposition,
};
export const Form: Story = {
  ...settings('composition-form'),
  name: '小型物品表单',
  render: FormComposition,
};
export const Operation: Story = {
  ...settings('composition-operation'),
  name: '操作与恢复面板',
  render: OperationComposition,
};
export const Management: Story = {
  ...settings('composition-management'),
  name: '管理选择场景',
  render: ManagementComposition,
};
export const Shell: Story = {
  ...settings('composition-shell'),
  name: '双模式 Shell',
  render: ShellComposition,
};
