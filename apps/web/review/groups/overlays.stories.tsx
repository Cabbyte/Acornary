import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReviewDemoProps, ReviewScenario } from '../types';
import {
  DialogDemo,
  SheetDemo,
  PopoverDemo,
  TooltipDemo,
  DropdownMenuDemo,
  AlertDialogDemo,
  ToastDemo,
  InlineNoticeDemo,
  SkeletonDemo,
  EmptyStateDemo,
  LoadingStateDemo,
  modalScenarios,
  popoverScenarios,
  tooltipScenarios,
  menuScenarios,
  toastScenarios,
  noticeScenarios,
  skeletonScenarios,
  emptyScenarios,
  loadingScenarios,
} from './overlays-demos';

const meta = {
  id: 'rc1-overlays',
  title: 'RC2/浮层与反馈',
  args: { scenario: 'draft' },
} satisfies Meta<ReviewDemoProps>;
export default meta;
type Story = StoryObj<ReviewDemoProps>;
const controls = (scenarios: readonly ReviewScenario[]) => ({
  scenario: {
    control: 'select' as const,
    options: scenarios.map(({ id }) => id),
    description: '切换实际传入组件的演示状态',
  },
});
export const Dialog: Story = {
  name: 'Dialog 对话框',
  render: DialogDemo,
  argTypes: controls(modalScenarios),
};
export const Sheet: Story = {
  name: 'Sheet 任务面板',
  render: SheetDemo,
  argTypes: controls(modalScenarios),
};
export const Popover: Story = {
  name: 'Popover 补充信息',
  render: PopoverDemo,
  args: { scenario: 'keyboard' },
  argTypes: controls(popoverScenarios),
};
export const Tooltip: Story = {
  name: 'Tooltip 简短提示',
  render: TooltipDemo,
  args: { scenario: 'keyboard' },
  argTypes: controls(tooltipScenarios),
};
export const DropdownMenu: Story = {
  name: 'DropdownMenu 操作菜单',
  render: DropdownMenuDemo,
  args: { scenario: 'keyboard' },
  argTypes: controls(menuScenarios),
};
export const AlertDialog: Story = {
  name: 'AlertDialog 确认对话框',
  render: AlertDialogDemo,
  argTypes: controls(modalScenarios),
};
export const Toast: Story = {
  name: 'Toast 辅助通知',
  render: ToastDemo,
  args: { scenario: 'info' },
  argTypes: controls(toastScenarios),
};
export const InlineNotice: Story = {
  name: 'InlineNotice 行内提示',
  render: InlineNoticeDemo,
  args: { scenario: 'info' },
  argTypes: controls(noticeScenarios),
};
export const Skeleton: Story = {
  name: 'Skeleton 加载占位',
  render: SkeletonDemo,
  args: { scenario: 'text' },
  argTypes: controls(skeletonScenarios),
};
export const EmptyState: Story = {
  name: 'EmptyState 空与不可读状态',
  render: EmptyStateDemo,
  args: { scenario: 'empty' },
  argTypes: controls(emptyScenarios),
};
export const LoadingState: Story = {
  name: 'LoadingState 读取状态',
  render: LoadingStateDemo,
  args: { scenario: 'loading' },
  argTypes: controls(loadingScenarios),
};
