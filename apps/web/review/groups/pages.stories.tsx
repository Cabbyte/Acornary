import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReviewDemoProps } from '../types';
import {
  pageEntries,
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
