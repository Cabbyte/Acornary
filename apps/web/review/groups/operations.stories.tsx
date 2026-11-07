import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReviewDemoProps, ReviewScenario } from '../types';
import {
  ApprovalSummaryDemo,
  ConflictResolutionDemo,
  OperationReceiptDemo,
  PendingOperationBannerDemo,
  OfflineBannerDemo,
  DraftStatusDemo,
  OperationSheetDemo,
  CapabilityNoticeDemo,
  ScanInputDemo,
  LabelPrintPanelDemo,
  approvalScenarios,
  conflictScenarios,
  receiptScenarios,
  pendingScenarios,
  offlineScenarios,
  draftScenarios,
  operationStateScenarios,
  capabilityScenarios,
  scanScenarios,
  printScenarios,
} from './operations-demos';

const meta = {
  id: 'rc1-operations',
  title: 'RC4/操作恢复与能力',
  args: { scenario: 'normal' },
} satisfies Meta<ReviewDemoProps>;
export default meta;
type Story = StoryObj<ReviewDemoProps>;
const controls = (scenarios: readonly ReviewScenario[]) => ({
  scenario: {
    control: 'select' as const,
    options: scenarios.map(({ id }) => id),
    description: '切换实际传入组件的展示状态',
  },
});
export const ApprovalSummary: Story = {
  name: 'ApprovalSummary 批准范围',
  render: ApprovalSummaryDemo,
  argTypes: controls(approvalScenarios),
};
export const ConflictResolution: Story = {
  name: 'ConflictResolution 冲突核对',
  render: ConflictResolutionDemo,
  argTypes: controls(conflictScenarios),
};
export const OperationReceipt: Story = {
  name: 'OperationReceipt 操作回执',
  render: OperationReceiptDemo,
  args: { scenario: 'success' },
  argTypes: controls(receiptScenarios),
};
export const PendingOperationBanner: Story = {
  name: 'PendingOperationBanner 待确认任务',
  render: PendingOperationBannerDemo,
  args: { scenario: 'unknown' },
  argTypes: controls(pendingScenarios),
};
export const OfflineBanner: Story = {
  name: 'OfflineBanner 离线范围',
  render: OfflineBannerDemo,
  args: { scenario: 'partial' },
  argTypes: controls(offlineScenarios),
};
export const DraftStatus: Story = {
  name: 'DraftStatus 草稿状态',
  render: DraftStatusDemo,
  args: { scenario: 'saved' },
  argTypes: controls(draftScenarios),
};
export const OperationSheet: Story = {
  name: 'OperationSheet 操作面板',
  render: OperationSheetDemo,
  args: { scenario: 'draft' },
  argTypes: controls(operationStateScenarios),
};
export const CapabilityNotice: Story = {
  name: 'CapabilityNotice 能力说明',
  render: CapabilityNoticeDemo,
  args: { scenario: 'unsupportedHost' },
  argTypes: controls(capabilityScenarios),
};
export const ScanInput: Story = {
  name: 'ScanInput 扫码输入',
  render: ScanInputDemo,
  args: { scenario: 'barcode' },
  argTypes: controls(scanScenarios),
};
export const LabelPrintPanel: Story = {
  name: 'LabelPrintPanel 标签打印',
  render: LabelPrintPanelDemo,
  args: { scenario: 'not-sent' },
  argTypes: controls(printScenarios),
};
