import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReviewDemoProps } from '../types';
import {
  AttributeFieldsDemo,
  NoteEditorDemo,
  AttachmentListDemo,
  AttachmentFieldDemo,
  HistoryEntryDemo,
  HistoryChangesDemo,
  attributeFieldsScenarios,
  noteEditorScenarios,
  attachmentListScenarios,
  attachmentFieldScenarios,
  historyEntryScenarios,
  historyChangesScenarios,
} from './content-demos';

const meta = {
  id: 'rc1-content',
  title: 'RC3/编辑与历史',
  args: { scenario: 'normal' },
} satisfies Meta<ReviewDemoProps>;
export default meta;
type Story = StoryObj<ReviewDemoProps>;
export const AttributeFields: Story = {
  name: 'AttributeFields 属性字段',
  render: (args) => <AttributeFieldsDemo {...args} />,
  argTypes: {
    scenario: { control: 'select', options: attributeFieldsScenarios.map(({ id }) => id) },
  },
};
export const NoteEditor: Story = {
  name: 'NoteEditor 备注编辑',
  render: (args) => <NoteEditorDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: noteEditorScenarios.map(({ id }) => id) } },
};
export const AttachmentList: Story = {
  name: 'AttachmentList 附件列表',
  render: (args) => <AttachmentListDemo {...args} />,
  argTypes: {
    scenario: { control: 'select', options: attachmentListScenarios.map(({ id }) => id) },
  },
};
export const AttachmentField: Story = {
  name: 'AttachmentField 附件选择',
  render: (args) => <AttachmentFieldDemo {...args} />,
  argTypes: {
    scenario: { control: 'select', options: attachmentFieldScenarios.map(({ id }) => id) },
  },
};
export const HistoryEntry: Story = {
  name: 'HistoryEntry 历史记录',
  render: (args) => <HistoryEntryDemo {...args} />,
  argTypes: { scenario: { control: 'select', options: historyEntryScenarios.map(({ id }) => id) } },
};
export const HistoryChanges: Story = {
  name: 'HistoryChanges 变更对比',
  render: (args) => <HistoryChangesDemo {...args} />,
  argTypes: {
    scenario: { control: 'select', options: historyChangesScenarios.map(({ id }) => id) },
  },
};
