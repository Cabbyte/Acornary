import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReviewDemoProps } from '../types';
import {
  DataTableDemo,
  PaginationControlsDemo,
  ItemStatusDemo,
  PageHeaderDemo,
  ProductSummaryDemo,
  ItemRowDemo,
  ItemCardDemo,
  AttentionSummaryDemo,
  BatchSelectionBarDemo,
  dataTableScenarios,
  paginationControlsScenarios,
  itemStatusScenarios,
  pageHeaderScenarios,
  productSummaryScenarios,
  itemRowScenarios,
  attentionSummaryScenarios,
  batchSelectionBarScenarios,
} from './lists-demos';

const meta = {
  id: 'rc1-lists',
  title: 'RC6/列表与选择',
  args: { scenario: 'normal' },
} satisfies Meta<ReviewDemoProps>;
export default meta;
type Story = StoryObj<ReviewDemoProps>;

export const DataTable: Story = {
  name: 'DataTable 数据表格',
  render: (args) => <DataTableDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: dataTableScenarios.map(({ id }) => id) } },
};
export const PaginationControls: Story = {
  name: 'PaginationControls 分页控制',
  render: (args) => <PaginationControlsDemo {...args} />,
  argTypes: {
    scenario: { control: 'select', options: paginationControlsScenarios.map(({ id }) => id) },
  },
};
export const ItemStatus: Story = {
  name: 'ItemStatus 物品状态',
  render: (args) => <ItemStatusDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: itemStatusScenarios.map(({ id }) => id) } },
};
export const PageHeader: Story = {
  name: 'PageHeader 页面标题',
  render: (args) => <PageHeaderDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: pageHeaderScenarios.map(({ id }) => id) } },
};
export const ProductSummary: Story = {
  name: 'ProductSummary 商品汇总',
  render: (args) => <ProductSummaryDemo {...args} />,
  argTypes: {
    scenario: { control: 'select', options: productSummaryScenarios.map(({ id }) => id) },
  },
};
export const ItemRow: Story = {
  name: 'ItemRow 物品行',
  render: (args) => <ItemRowDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: itemRowScenarios.map(({ id }) => id) } },
};
export const ItemCard: Story = {
  name: 'ItemCard 物品卡片',
  render: (args) => <ItemCardDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: itemRowScenarios.map(({ id }) => id) } },
};
export const AttentionSummary: Story = {
  name: 'AttentionSummary 关注汇总',
  render: (args) => <AttentionSummaryDemo {...args} />,
  argTypes: {
    scenario: { control: 'select', options: attentionSummaryScenarios.map(({ id }) => id) },
  },
};
export const BatchSelectionBar: Story = {
  name: 'BatchSelectionBar 批量选择栏',
  render: (args) => <BatchSelectionBarDemo {...args} />,
  argTypes: {
    scenario: { control: 'select', options: batchSelectionBarScenarios.map(({ id }) => id) },
  },
};
