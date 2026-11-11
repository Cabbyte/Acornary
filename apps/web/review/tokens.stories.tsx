import type { Meta, StoryObj } from '@storybook/react-vite';
import { TokenReview } from './TokenReview';
const meta = {
  title: '视觉基础/B00 双色与尺度',
  component: TokenReview,
  args: { initialMode: 'daily' },
  argTypes: { initialMode: { control: 'radio', options: ['daily', 'management'] } },
} satisfies Meta<typeof TokenReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Daily: Story = { name: '日常模式' };
export const Management: Story = { name: '管理模式', args: { initialMode: 'management' } };
