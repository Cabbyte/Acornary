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

export const Opening: Story = {
  ...settings(10),
  name: '开封记录',
  render: (props) => {
    const Component = pageEntries[10].component;
    return <Component {...props} />;
  },
};
export const Dates: Story = {
  ...settings(11),
  name: '日期事项',
  render: (props) => {
    const Component = pageEntries[11].component;
    return <Component {...props} />;
  },
};
export const Notes: Story = {
  ...settings(12),
  name: '笔记',
  render: (props) => {
    const Component = pageEntries[12].component;
    return <Component {...props} />;
  },
};
export const Attachments: Story = {
  ...settings(13),
  name: '附件',
  render: (props) => {
    const Component = pageEntries[13].component;
    return <Component {...props} />;
  },
};
export const Scan: Story = {
  ...settings(14),
  name: '扫码',
  render: (props) => {
    const Component = pageEntries[14].component;
    return <Component {...props} />;
  },
};
export const Labels: Story = {
  ...settings(15),
  name: '标签打印',
  render: (props) => {
    const Component = pageEntries[15].component;
    return <Component {...props} />;
  },
};
export const ManageItems: Story = {
  ...settings(16),
  name: '物品管理',
  render: (props) => {
    const Component = pageEntries[16].component;
    return <Component {...props} />;
  },
};
export const ManageCatalog: Story = {
  ...settings(17),
  name: '商品目录',
  render: (props) => {
    const Component = pageEntries[17].component;
    return <Component {...props} />;
  },
};
export const ManageLocations: Story = {
  ...settings(18),
  name: '位置与容器',
  render: (props) => {
    const Component = pageEntries[18].component;
    return <Component {...props} />;
  },
};
export const ManageEdit: Story = {
  ...settings(19),
  name: '精确编辑',
  render: (props) => {
    const Component = pageEntries[19].component;
    return <Component {...props} />;
  },
};
export const ManageBulk: Story = {
  ...settings(20),
  name: '批量管理',
  render: (props) => {
    const Component = pageEntries[20].component;
    return <Component {...props} />;
  },
};
export const ManageHistory: Story = {
  ...settings(21),
  name: '历史与纠错',
  render: (props) => {
    const Component = pageEntries[21].component;
    return <Component {...props} />;
  },
};
export const Settings: Story = {
  ...settings(22),
  name: '设置',
  render: (props) => {
    const Component = pageEntries[22].component;
    return <Component {...props} />;
  },
};
export const SettingsHousehold: Story = {
  ...settings(23),
  name: '账号与家庭',
  render: (props) => {
    const Component = pageEntries[23].component;
    return <Component {...props} />;
  },
};
export const SettingsMembers: Story = {
  ...settings(24),
  name: '成员权限',
  render: (props) => {
    const Component = pageEntries[24].component;
    return <Component {...props} />;
  },
};
export const SettingsAuth: Story = {
  ...settings(25),
  name: '登录与授权',
  render: (props) => {
    const Component = pageEntries[25].component;
    return <Component {...props} />;
  },
};
export const SettingsPrinting: Story = {
  ...settings(26),
  name: '打印设置',
  render: (props) => {
    const Component = pageEntries[26].component;
    return <Component {...props} />;
  },
};
export const SettingsCache: Story = {
  ...settings(27),
  name: '缓存与离线',
  render: (props) => {
    const Component = pageEntries[27].component;
    return <Component {...props} />;
  },
};
export const SettingsInspector: Story = {
  ...settings(28),
  name: '只读检查器',
  render: (props) => {
    const Component = pageEntries[28].component;
    return <Component {...props} />;
  },
};
