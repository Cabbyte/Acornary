import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReviewDemoProps } from '../types';
import {
  pageEntries,
  IntakePageDemo,
  NewProductPageDemo,
  ConsumePageDemo,
  MovePageDemo,
  AttentionPageDemo,
  ActivityPageDemo,
  HomePageDemo,
  SearchPageDemo,
  ProductPageDemo,
  ItemPageDemo,
} from './pages-demos';
export default {
  id: 'pages-daily',
  title: '页面/P01 日常浏览',
  parameters: { layout: 'fullscreen', pageReview: true },
} satisfies Meta<ReviewDemoProps>;
type Story = StoryObj<ReviewDemoProps>;
function settings(index: number) {
  return {
    args: { scenario: 'normal' },
    argTypes: {
      scenario: {
        options: pageEntries[index].scenarios.map((s) => s.id),
        control: {
          type: 'select' as const,
          labels: Object.fromEntries(pageEntries[index].scenarios.map((s) => [s.id, s.label])),
        },
      },
    },
  };
}
export const Home: Story = { ...settings(0), name: '我的物品', render: HomePageDemo };
export const Search: Story = { ...settings(1), name: '搜索结果', render: SearchPageDemo };
export const Product: Story = { ...settings(2), name: '商品资料', render: ProductPageDemo };
export const Item: Story = { ...settings(3), name: '单件档案', render: ItemPageDemo };

export const Attention: Story = { ...settings(4), name: '需要留意', render: AttentionPageDemo };
export const Activity: Story = { ...settings(5), name: '最近变化', render: ActivityPageDemo };

export const Intake: Story = { ...settings(6), name: '已有商品入库', render: IntakePageDemo };
export const NewProduct: Story = { ...settings(7), name: '新商品入库', render: NewProductPageDemo };
export const Consume: Story = { ...settings(8), name: '记录使用', render: ConsumePageDemo };
export const Move: Story = { ...settings(9), name: '移动物品', render: MovePageDemo };
