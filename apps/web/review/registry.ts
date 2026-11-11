import reviewStatus from './review-status.json';
import type { ReviewEntry, ReviewStatus } from './types';
import { pageDefinitions } from './pages/catalog';
export const expectedPageIds = pageDefinitions.map((page) => page.id);
const groups = import.meta.glob('./groups/*-demos.tsx', { eager: true });
const order = [
  'Button',
  'IconButton',
  'Input',
  'Textarea',
  'FormField',
  'Badge',
  'Checkbox',
  'RadioGroup',
  'Switch',
  'Select',
  'Combobox',
  'Tabs',
  'Dialog',
  'Sheet',
  'Popover',
  'Tooltip',
  'DropdownMenu',
  'AlertDialog',
  'Calendar',
  'DateInput',
  'Table',
  'DataTable',
  'PaginationControls',
  'TreeView',
  'Skeleton',
  'Toast',
  'InlineNotice',
  'Separator',
  'ItemIdentity',
  'QuantityValue',
  'DateFactValue',
  'LocationPath',
  'ItemStatus',
  'FactSource',
  'SearchBar',
  'FilterBar',
  'QuantityInput',
  'DateFactField',
  'CatalogPicker',
  'LocationPicker',
  'PageHeader',
  'ProductSummary',
  'ItemRow',
  'ItemCard',
  'AttentionSummary',
  'BatchSelectionBar',
  'EmptyState',
  'LoadingState',
  'ApprovalSummary',
  'ConflictResolution',
  'OperationReceipt',
  'PendingOperationBanner',
  'OfflineBanner',
  'DraftStatus',
  'OperationSheet',
  'ModeSwitcher',
  'AppearancePicker',
  'DesktopNavigation',
  'MobileNavigation',
  'HouseholdSwitcher',
  'AppShell',
  'AttributeFields',
  'NoteEditor',
  'AttachmentList',
  'AttachmentField',
  'HistoryEntry',
  'HistoryChanges',
  'CapabilityNotice',
  'ScanInput',
  'LabelPrintPanel',
];
export const expectedIds = order.map((name) =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(),
);
const sections: [string, number][] = [
  ['基础输入与选择', 12],
  ['弹层', 6],
  ['结构与通用反馈', 10],
  ['事实表达', 6],
  ['领域输入', 6],
  ['列表与阅读状态', 8],
  ['操作与恢复', 7],
  ['导航与外观', 6],
  ['其他共享能力', 9],
];
const taxonomy = new Map<string, string>();
let offset = 0;
for (const [group, count] of sections) {
  for (const id of expectedIds.slice(offset, offset + count)) taxonomy.set(id, group);
  offset += count;
}
export const entries: ReviewEntry[] = Object.values(groups)
  .flatMap((module) =>
    Object.entries(module as Record<string, unknown>)
      .filter(([key]) => key.endsWith('Entries'))
      .flatMap(([, value]) => value as ReviewEntry[]),
  )
  .map((entry) => ({
    ...entry,
    group: taxonomy.get(entry.id) ?? entry.group,
    version:
      reviewStatus.entries[entry.id as keyof typeof reviewStatus.entries]?.version ??
      entry.version ??
      reviewStatus.version,
    status: (reviewStatus.entries[entry.id as keyof typeof reviewStatus.entries]?.status ??
      '待审阅') as ReviewStatus,
  }))
  .sort(
    (a, b) =>
      (a.kind === 'page'
        ? expectedPageIds.indexOf(a.id as (typeof expectedPageIds)[number]) - expectedPageIds.length
        : expectedIds.includes(a.id)
          ? expectedIds.indexOf(a.id)
          : 100) -
      (b.kind === 'page'
        ? expectedPageIds.indexOf(b.id as (typeof expectedPageIds)[number]) - expectedPageIds.length
        : expectedIds.includes(b.id)
          ? expectedIds.indexOf(b.id)
          : 100),
  );
