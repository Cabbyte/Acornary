import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReviewDemoProps } from '../types';
import {
  TableDemo,
  TreeViewDemo,
  SeparatorDemo,
  ItemIdentityDemo,
  QuantityValueDemo,
  DateFactValueDemo,
  LocationPathDemo,
  FactSourceDemo,
  tableScenarios,
  treeViewScenarios,
  separatorScenarios,
  itemIdentityScenarios,
  quantityValueScenarios,
  dateFactValueScenarios,
  locationPathScenarios,
  factSourceScenarios,
} from './facts-demos';

const meta = {
  id: 'rc1-facts',
  title: 'RC4/事实与结构',
  args: { scenario: 'normal' },
} satisfies Meta<ReviewDemoProps>;
export default meta;
type Story = StoryObj<ReviewDemoProps>;

export const Table: Story = {
  name: 'Table 表格',
  render: (args) => <TableDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: tableScenarios.map(({ id }) => id) } },
};
export const TreeView: Story = {
  name: 'TreeView 层级树',
  render: (args) => <TreeViewDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: treeViewScenarios.map(({ id }) => id) } },
};
export const Separator: Story = {
  name: 'Separator 分隔线',
  args: { scenario: 'horizontal' },
  render: (args) => <SeparatorDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: separatorScenarios.map(({ id }) => id) } },
};
export const ItemIdentity: Story = {
  name: 'ItemIdentity 物品身份',
  render: (args) => <ItemIdentityDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: itemIdentityScenarios.map(({ id }) => id) } },
};
export const QuantityValue: Story = {
  name: 'QuantityValue 数量事实',
  render: (args) => <QuantityValueDemo {...args} />,
  argTypes: {
    scenario: { control: 'select', options: quantityValueScenarios.map(({ id }) => id) },
  },
};
export const DateFactValue: Story = {
  name: 'DateFactValue 日期事实',
  render: (args) => <DateFactValueDemo {...args} />,
  argTypes: {
    scenario: { control: 'select', options: dateFactValueScenarios.map(({ id }) => id) },
  },
};
export const LocationPath: Story = {
  name: 'LocationPath 位置路径',
  render: (args) => <LocationPathDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: locationPathScenarios.map(({ id }) => id) } },
};
export const FactSource: Story = {
  name: 'FactSource 事实来源',
  render: (args) => <FactSourceDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: factSourceScenarios.map(({ id }) => id) } },
};
