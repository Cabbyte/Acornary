import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReviewDemoProps } from '../types';
import {
  controlsEntries,
  ButtonDemo,
  IconButtonDemo,
  InputDemo,
  TextareaDemo,
  FormFieldDemo,
  BadgeDemo,
  CheckboxDemo,
  RadioGroupDemo,
  SwitchDemo,
  SelectDemo,
  ComboboxDemo,
  TabsDemo,
} from './controls-demos';
import { DateInputDemo } from './fields-demos';

const meta = {
  id: 'rc1-controls',
  title: 'RC5/基础控件',
  parameters: { layout: 'padded' },
} satisfies Meta<ReviewDemoProps>;
export default meta;
type Story = StoryObj<ReviewDemoProps>;
function settings(id: string) {
  const entry = controlsEntries.find((candidate) => candidate.id === id)!;
  return {
    args: { scenario: entry.scenarios[0].id },
    argTypes: {
      scenario: {
        control: {
          type: 'select' as const,
          labels: Object.fromEntries(
            entry.scenarios.map((scenario) => [scenario.id, scenario.label]),
          ),
        },
        options: entry.scenarios.map((scenario) => scenario.id),
        description: '组件状态场景',
      },
    },
  };
}
export const Button: Story = { ...settings('button'), name: '按钮', render: ButtonDemo };
export const IconButton: Story = {
  ...settings('icon-button'),
  name: '图标按钮',
  render: IconButtonDemo,
};
export const Input: Story = { ...settings('input'), name: '单行输入', render: InputDemo };
export const Textarea: Story = { ...settings('textarea'), name: '多行输入', render: TextareaDemo };
export const FormField: Story = {
  ...settings('form-field'),
  name: '表单字段',
  render: FormFieldDemo,
};
export const Badge: Story = { ...settings('badge'), name: '状态标签', render: BadgeDemo };
export const Checkbox: Story = { ...settings('checkbox'), name: '复选框', render: CheckboxDemo };
export const RadioGroup: Story = {
  ...settings('radio-group'),
  name: '单选组',
  render: RadioGroupDemo,
};
export const Switch: Story = { ...settings('switch'), name: '开关', render: SwitchDemo };
export const Select: Story = { ...settings('select'), name: '下拉选择', render: SelectDemo };
export const Combobox: Story = { ...settings('combobox'), name: '搜索选择', render: ComboboxDemo };
export const Tabs: Story = { ...settings('tabs'), name: '标签页', render: TabsDemo };

/** Local field widths must not switch the density chosen by the theme host. */
export const DensityAlignment: Story = {
  name: '控件密度与标签对齐',
  args: { scenario: 'default' },
  argTypes: {
    scenario: {
      control: 'select',
      options: ['default', 'error', 'disabled', 'readonly', 'long-text'],
    },
  },
  render: (props) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
        alignItems: 'start',
        gap: 'var(--vn-space-24)',
      }}
    >
      <InputDemo {...props} />
      <div className="vn-domain-field">
        <SelectDemo {...props} />
      </div>
      <div className="vn-domain-field">
        <ComboboxDemo {...props} />
      </div>
      <DateInputDemo {...props} />
    </div>
  ),
};
