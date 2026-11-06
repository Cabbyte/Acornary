import { ReviewNote, ReviewFeedback } from '../review-frame';
import { useEffect, useState, type ReactNode } from 'react';
import type {
  AttributeBindingV2,
  HistoryEventV2,
  TemplateDefinitionV2,
  TemplateFieldV2,
} from '../../../../packages/contracts/src/read-v2';
import type { ReviewDemoProps, ReviewEntry, ReviewScenario } from '../types';
import { InlineNotice } from '../../src/ui/components/ui/inline-notice';
import {
  AttributeFields,
  type AttributeFieldEdit,
  type AttributeFieldState,
} from '../../src/ui/patterns/attribute-fields';
import { NoteEditor, type NoteDraft } from '../../src/ui/patterns/note-editor';
import { AttachmentList, type AttachmentPresentation } from '../../src/ui/patterns/attachment-list';
import { AttachmentField, type PendingAttachment } from '../../src/ui/patterns/attachment-field';
import { HistoryEntry } from '../../src/ui/patterns/history-entry';
import {
  HistoryChanges,
  type HistoryChangePresentation,
} from '../../src/ui/patterns/history-changes';
import type {
  ActionAvailability,
  AttachmentView,
  QuantityPresentation,
} from '../../src/ui/patterns/types';

// Review-only fixtures, based on frozen registry field names. No requests, uploads or writes.
const itemId = 'item_11111111-1111-4111-8111-000000000031';
const catalogId = 'catalog_node_22222222-2222-4222-8222-000000000031';
const attachmentId = 'attachment_33333333-3333-4333-8333-000000000031';
const actorId = 'actor_44444444-4444-4444-8444-000000000031';
const longText =
  '厨房北侧高柜 / 第二层 / 透明密封收纳盒 / 家庭备用装。请保留原始说明与每件物品的完整身份，核对标签上的日期，不根据购买时间自行推算。';
const available: ActionAvailability = { kind: 'available' };
function Preview({ children, message }: { children: ReactNode; message?: string }) {
  return (
    <div className="vn-stack">
      {children}
      {message && <ReviewFeedback>{message}</ReviewFeedback>}
    </div>
  );
}
function useLog(scenario: string) {
  const [message, setMessage] = useState('尚未触发操作。');
  useEffect(() => setMessage('尚未触发操作。'), [scenario]);
  return [message, setMessage] as const;
}
function scenarios(...rows: [string, string][]): readonly ReviewScenario[] {
  return rows.map(([id, label]) => ({ id, label }));
}

export const attributeFieldsScenarios = scenarios(
  ['normal', '物品属性'],
  ['sku', '商品共享属性'],
  ['boolean', '布尔字段'],
  ['decimal', '精确小数'],
  ['quantity', '计量字段'],
  ['unknown', '未知字段与值'],
  ['unrecognized-parent', '旧内容结构不匹配'],
  ['nested-redacted', '嵌套内容不可见'],
  ['unrecorded', '未记录'],
  ['mixed', '多个值'],
  ['redacted', '内容不可见'],
  ['readonly', '只读'],
  ['old-version', '版本不匹配'],
  ['empty', '没有字段'],
  ['loading', '读取中'],
  ['error', '字段错误'],
  ['denied', '没有权限'],
  ['long-text', '长说明与路径'],
);
const lifecycleFields: TemplateFieldV2[] = [
  {
    path: 'acquisition.batch_label',
    label: '购入批次',
    type: 'string',
    section: 'acquisition',
    order: 0,
  },
  {
    path: 'acquisition.acquired_on',
    label: '购入日期',
    type: 'date',
    section: 'acquisition',
    order: 1,
  },
  {
    path: 'opening.state',
    label: '开封状态',
    type: 'enum',
    section: 'opening',
    order: 2,
    options: [
      { value: 'SEALED', label: '未开封' },
      { value: 'OPENED', label: '已开封' },
    ],
  },
  {
    path: 'expiry.after_opening_days',
    label: '开封后天数',
    type: 'number',
    section: 'expiry',
    order: 3,
    unit: '天',
  },
];
function attributeFixture(scenario: string): {
  template: TemplateDefinitionV2;
  binding: AttributeBindingV2;
  scope: 'ITEM' | 'SKU';
} {
  let id = 'lifecycle',
    name = '物品使用与日期',
    fields = lifecycleFields,
    scope: 'ITEM' | 'SKU' = 'ITEM';
  let values: Record<string, unknown> = {
    acquisition: {
      batch_label: scenario === 'long-text' ? longText.repeat(3) : '周末采购',
      acquired_on: '2026-11-05',
    },
    opening: { state: 'SEALED' },
    expiry: { after_opening_days: 3 },
  };
  if (scenario === 'sku') {
    id = 'product';
    name = '商品资料';
    scope = 'SKU';
    fields = [
      { path: 'brand', label: '品牌', type: 'string', section: 'product', order: 0 },
      { path: 'barcodes', label: '条码', type: 'string', section: 'product', order: 1 },
    ];
    values = { brand: '山间小屋', barcodes: ['6900000000001', '6900000000002'] };
  }
  if (scenario === 'boolean') {
    id = 'container';
    name = '容器属性';
    fields = [
      {
        path: 'can_contain',
        label: '可以容纳其他物品',
        type: 'boolean',
        section: 'container',
        order: 0,
      },
    ];
    values = { can_contain: false };
  }
  if (scenario === 'decimal') {
    id = 'device';
    name = '设备规格';
    scope = 'SKU';
    fields = [
      {
        path: 'rated_power_w',
        label: '额定功率',
        type: 'decimal',
        section: 'device',
        order: 0,
        unit: 'W',
      },
      { path: 'connector', label: '接口', type: 'string', section: 'device', order: 1 },
    ];
    values = { rated_power_w: '12.5000', connector: 'USB-C' };
  }
  if (scenario === 'quantity') {
    id = 'contents';
    name = '物品内容量';
    fields = [
      { path: 'remaining', label: '剩余量', type: 'measurement', section: 'contents', order: 0 },
    ];
    values = { remaining: { value: '375.5000', unit: 'mL' }, accuracy: 'MEASURED' };
  }
  if (scenario === 'unknown')
    values = { ...values, legacy_serial: '原记录保留：AB-731', unidentified: { volume: '不确定' } };
  if (scenario === 'unrecognized-parent')
    values = { ...values, acquisition: '原有自由文本，不能由子字段修改覆盖' };
  if (scenario === 'nested-redacted')
    values = { ...values, legacy: [{ private_note: '此内容不得展示' }] };
  if (scenario === 'long-text')
    values = { ...values, legacy: { archived: { storage: { description: longText.repeat(2) } } } };
  if (scenario === 'unrecorded') values = {};
  if (scenario === 'empty') {
    fields = [];
    values = {};
  }
  const template: TemplateDefinitionV2 = {
    id,
    version: 1,
    name,
    target_kind: scope === 'ITEM' ? 'ITEM' : 'CATALOG_NODE',
    allowed_catalog_node_kinds: scope === 'SKU' ? ['SKU'] : [],
    paths: fields.map((field) => field.path),
    fields,
  };
  return {
    template,
    binding: {
      template_id: id,
      template_version: scenario === 'old-version' ? 2 : 1,
      values,
      status: 'KNOWN',
    },
    scope,
  };
}
function patchAt(
  values: Record<string, unknown>,
  path: string,
  next: unknown,
): Record<string, unknown> {
  const [head, ...tail] = path.split('.');
  const current = values[head];
  return {
    ...values,
    [head]: tail.length
      ? patchAt(
          current !== null && typeof current === 'object' && !Array.isArray(current)
            ? (current as Record<string, unknown>)
            : {},
          tail.join('.'),
          next,
        )
      : next,
  };
}
export function AttributeFieldsDemo({ scenario }: ReviewDemoProps) {
  const fixture = attributeFixture(scenario);
  const [values, setValues] = useState(fixture.binding.values);
  const [quantity, setQuantity] = useState<QuantityPresentation>({
    value: '375.5000',
    unit: 'mL',
    accuracy: 'measured',
  });
  const [message, log] = useLog(scenario);
  useEffect(() => {
    setValues(attributeFixture(scenario).binding.values);
    setQuantity({ value: '375.5000', unit: 'mL', accuracy: 'measured' });
  }, [scenario]);
  const fieldStates: Record<string, AttributeFieldState> =
    scenario === 'nested-redacted'
      ? {
          'legacy.private_note': { kind: 'redacted', reason: '旧记录中包含当前成员不可见的内容。' },
        }
      : scenario === 'redacted'
        ? { 'acquisition.batch_label': { kind: 'redacted', reason: '当前权限不允许查看此批次。' } }
        : scenario === 'unknown'
          ? { 'acquisition.acquired_on': { kind: 'unknown', reason: '尚未核对原始票据。' } }
          : scenario === 'mixed'
            ? { 'opening.state': { kind: 'mixed', reason: '所选物品开封状态不同，请分别核对。' } }
            : {};
  const change = (edit: AttributeFieldEdit) => {
    if (edit.kind === 'quantityDraft') setQuantity(edit.value);
    else
      setValues((current) =>
        patchAt(current, edit.path, edit.kind === 'numberDraft' ? edit.text : edit.value),
      );
    log(`已修改本地属性草稿：${edit.path}。模板版本与其他原值保持不变。`);
  };
  return (
    <Preview message={message}>
      <AttributeFields
        template={fixture.template}
        binding={{ ...fixture.binding, values }}
        scope={{
          kind: fixture.scope,
          id: fixture.scope === 'SKU' ? catalogId : itemId,
          label: fixture.scope === 'SKU' ? '同款燕麦饮' : '厨房的这一件燕麦饮',
        }}
        fieldStates={fieldStates}
        onChange={change}
        quantities={
          scenario === 'quantity'
            ? {
                remaining: {
                  value: quantity,
                  units: [
                    { value: 'mL', label: '毫升' },
                    { value: 'g', label: '克' },
                  ],
                },
              }
            : undefined
        }
        errors={
          scenario === 'error'
            ? { 'acquisition.batch_label': '批次说明超过允许长度，请缩短后继续。' }
            : undefined
        }
        readOnly={scenario === 'readonly'}
        loading={scenario === 'loading'}
        availability={
          scenario === 'denied'
            ? { kind: 'forbidden', reason: '当前成员只能查看这些属性。' }
            : available
        }
        calendarMonth="2026-11"
        today="2026-11-06"
      />
    </Preview>
  );
}

export const noteEditorScenarios = scenarios(
  ['normal', '编辑备注'],
  ['preview', 'Markdown 预览'],
  ['plain', '纯文本预览'],
  ['empty', '空白备注'],
  ['unknown', '正文未读取'],
  ['readonly', '只读'],
  ['redacted', '内容不可见'],
  ['busy', '处理中'],
  ['error', '保存失败'],
  ['denied', '没有权限'],
  ['long-text', '长备注'],
);
function noteFixture(scenario: string): NoteDraft {
  return {
    title: scenario === 'empty' ? null : '使用记录',
    body:
      scenario === 'unknown'
        ? undefined
        : scenario === 'empty'
          ? ''
          : scenario === 'long-text'
            ? `${longText}\n\n`.repeat(18)
            : '开封后放入冷藏室。\n\n## 下次使用\n- 先查看标签\n- 取用后及时密封\n\n<script>不会执行</script>\n[说明链接](https://example.invalid/notes)',
  };
}
export function NoteEditorDemo({ scenario }: ReviewDemoProps) {
  const [value, setValue] = useState<NoteDraft>(noteFixture(scenario));
  const [mode, setMode] = useState<'edit' | 'preview'>(
    scenario === 'preview' || scenario === 'plain' ? 'preview' : 'edit',
  );
  const [dirty, setDirty] = useState(false);
  const [message, log] = useLog(scenario);
  useEffect(() => {
    setValue(noteFixture(scenario));
    setMode(scenario === 'preview' || scenario === 'plain' ? 'preview' : 'edit');
    setDirty(scenario === 'busy' || scenario === 'error');
  }, [scenario]);
  return (
    <Preview message={message}>
      <NoteEditor
        itemId={itemId}
        itemLabel="厨房的这一件燕麦饮"
        value={value}
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          log(next === 'preview' ? '已切换到备注预览。' : '已返回编辑，草稿保留。');
        }}
        previewFormat={scenario === 'plain' ? 'plain' : 'markdown'}
        onChange={(next) => {
          setValue(next);
          setDirty(true);
          log('本地备注草稿已更新。');
        }}
        onSaveIntent={() => log('已收到保存备注意图；此预览没有提交，草稿仍保留。')}
        onCancel={() => {
          setValue(noteFixture(scenario));
          setDirty(false);
          log('已放弃当前示例的修改。');
        }}
        dirty={dirty}
        readOnly={scenario === 'readonly'}
        redacted={scenario === 'redacted'}
        busy={scenario === 'busy'}
        error={scenario === 'error' ? '连接中断，保存结果未知，请先核对记录。' : undefined}
        availability={
          scenario === 'denied'
            ? { kind: 'forbidden', reason: '当前成员没有修改此物品备注的权限。' }
            : available
        }
      />
    </Preview>
  );
}

const attachmentFixture: AttachmentView[] = [
  {
    id: attachmentId,
    targetKind: 'ITEM',
    mimeType: 'application/pdf',
    fileSize: 248000,
    width: null,
    height: null,
    caption: '产品使用说明',
    sortOrder: 0,
    sensitivity: 'NORMAL',
    thumbnailUrl: null,
  },
  {
    id: 'attachment_33333333-3333-4333-8333-000000000032',
    targetKind: 'ITEM',
    mimeType: 'image/jpeg',
    fileSize: 1638400,
    width: 1600,
    height: 1200,
    caption: '购入时的原始标签',
    sortOrder: 1,
    sensitivity: 'SENSITIVE',
    thumbnailUrl: null,
  },
];
export const attachmentListScenarios = scenarios(
  ['normal', '附件列表'],
  ['empty', '没有附件'],
  ['loading', '读取中'],
  ['error', '读取失败'],
  ['unknown', '状态未知'],
  ['pending', '处理中'],
  ['restricted', '受限附件'],
  ['denied', '不可读取'],
  ['readonly', '只读'],
  ['long-text', '长文件名和说明'],
);
export function AttachmentListDemo({ scenario }: ReviewDemoProps) {
  const [attachments, setAttachments] = useState<AttachmentView[]>(
    scenario === 'empty' ? [] : attachmentFixture,
  );
  const [message, log] = useLog(scenario);
  useEffect(
    () =>
      setAttachments(
        scenario === 'empty'
          ? []
          : attachmentFixture.map((attachment) => ({
              ...attachment,
              caption: scenario === 'long-text' ? longText.repeat(2) : attachment.caption,
            })),
      ),
    [scenario],
  );
  const presentations: Record<string, AttachmentPresentation> = {
    [attachmentId]: {
      name:
        scenario === 'long-text'
          ? '家庭采购资料/厨房/储物柜/长期保留的产品使用说明与原始批次记录.pdf'
          : '使用说明.pdf',
      state: scenario === 'pending' ? 'pending' : scenario === 'unknown' ? 'unknown' : 'ready',
      reason: scenario === 'unknown' ? '尚未确认上次处理结果。' : undefined,
    },
    [attachmentFixture[1].id]: {
      name: '原始标签.jpg',
      state: scenario === 'restricted' ? 'restricted' : 'ready',
      reason: scenario === 'restricted' ? '当前成员不能查看受保护内容。' : undefined,
    },
  };
  return (
    <Preview message={message}>
      <AttachmentList
        attachments={attachments}
        presentations={presentations}
        state={
          scenario === 'loading' || scenario === 'error' || scenario === 'denied'
            ? scenario
            : 'ready'
        }
        readOnly={scenario === 'readonly'}
        removeAvailability={available}
        onOpen={(attachment) => log(`已收到查看附件意图：${attachment.id}。此示例没有真实文件。`)}
        onRemove={(attachment) => {
          setAttachments((current) => current.filter((entry) => entry.id !== attachment.id));
          log(`已从本地示例移除：${attachment.id}。`);
        }}
        onRetry={() => log('已收到重新读取意图；预览未发起请求。')}
      />
    </Preview>
  );
}

export const attachmentFieldScenarios = scenarios(
  ['normal', '手动选择文件'],
  ['empty', '尚未选择'],
  ['busy', '处理中'],
  ['failed', '失败可重试'],
  ['unknown', '结果未知保留'],
  ['readonly', '只读'],
  ['error', '添加错误'],
  ['unsupported', '入口不支持'],
  ['denied', '没有权限'],
  ['long-text', '长文件名'],
);
function pendingFixture(scenario: string): PendingAttachment[] {
  if (scenario === 'empty') return [];
  return [
    {
      id: 'local-file-001',
      name: scenario === 'long-text' ? `${longText.repeat(2)}.pdf` : '保修凭证.pdf',
      mimeType: 'application/pdf',
      size: 318000,
      state:
        scenario === 'failed'
          ? 'failed'
          : scenario === 'unknown'
            ? 'unknown'
            : scenario === 'busy'
              ? 'uploading'
              : 'selected',
      reason:
        scenario === 'failed'
          ? '文件处理失败，可以重试。'
          : scenario === 'unknown'
            ? '连接中断，尚未确认是否已添加。'
            : undefined,
    },
  ];
}
export function AttachmentFieldDemo({ scenario }: ReviewDemoProps) {
  const [pending, setPending] = useState<PendingAttachment[]>(pendingFixture(scenario));
  const [sequence, setSequence] = useState(2);
  const [message, log] = useLog(scenario);
  useEffect(() => {
    setPending(pendingFixture(scenario));
    setSequence(2);
  }, [scenario]);
  const capability: ActionAvailability =
    scenario === 'unsupported'
      ? { kind: 'unsupportedHost', reason: '当前对话入口不支持传输本机附件，请在应用中添加。' }
      : scenario === 'denied'
        ? { kind: 'forbidden', reason: '当前成员没有添加附件的权限。' }
        : available;
  return (
    <Preview message={message}>
      <AttachmentField
        capability={capability}
        allowLocalSelection={scenario !== 'unsupported'}
        pending={pending}
        readOnly={scenario === 'readonly'}
        busy={scenario === 'busy'}
        error={scenario === 'error' ? '所选文件不符合当前附件要求，请核对文件类型。' : undefined}
        onFilesSelected={(files) => {
          setPending((current) => [
            ...current,
            ...files.map((file, index): PendingAttachment => ({
              id: `local-file-${sequence + index}`,
              name: file.name,
              mimeType: file.type || null,
              size: file.size,
              state: 'selected',
            })),
          ]);
          setSequence((current) => current + files.length);
          log(`已在本地示例选择 ${files.length} 个文件；没有读取或上传内容。`);
        }}
        onUploadIntent={(ids) =>
          log(`已收到添加 ${ids.length} 个文件的意图；未执行上传，所选文件保持待添加。`)
        }
        onRetry={(id) => {
          setPending((current) =>
            current.map((file) =>
              file.id === id ? { ...file, state: 'selected', reason: undefined } : file,
            ),
          );
          log('已将本地示例恢复为待添加，未执行传输。');
        }}
        onRemove={(id) => {
          setPending((current) => current.filter((file) => file.id !== id));
          log('已从本地待添加列表移除文件。');
        }}
      />
    </Preview>
  );
}

const historyFixture: HistoryEventV2 = {
  id: 'event_55555555-5555-4555-8555-000000000031',
  target_kind: 'ITEM',
  target_id: itemId,
  operation_id: 'operation_66666666-6666-4666-8666-000000000031',
  event_type: 'ITEM_UPDATED',
  before_revision: 4,
  after_revision: 5,
  changes: [
    {
      path: 'contents.remaining',
      before_present: true,
      after_present: true,
      before: { value: '500.0000', unit: 'mL' },
      after: { value: '375.5000', unit: 'mL' },
      template_id: 'contents',
      template_version: 1,
    },
    {
      path: 'lifecycle.acquisition.batch_label',
      before_present: false,
      after_present: true,
      after: '周末采购',
      template_id: 'lifecycle',
      template_version: 1,
    },
  ],
  reason: '核对包装和使用记录后补充信息。',
  actor_id: actorId,
  source: 'WEB',
  occurred_at: '2026-11-06T07:30:00Z',
  recorded_at: '2026-11-06T07:30:02Z',
};
const changeLabels: Record<string, HistoryChangePresentation> = {
  'contents.remaining': { label: '剩余量' },
  'lifecycle.acquisition.batch_label': { label: '购入批次' },
};
export const historyEntryScenarios = scenarios(
  ['normal', '历史事件'],
  ['collapsed', '收起变更'],
  ['unknown', '操作人和时区未知'],
  ['no-timezone', '未提供家庭时区'],
  ['redacted', '前后值不可见'],
  ['readonly', '不可更正'],
  ['empty', '没有字段变更'],
  ['loading', '读取中'],
  ['error', '读取失败'],
  ['long-text', '长原因与对象名'],
);
export function HistoryEntryDemo({ scenario }: ReviewDemoProps) {
  const [expanded, setExpanded] = useState(scenario !== 'collapsed');
  const [message, log] = useLog(scenario);
  useEffect(() => setExpanded(scenario !== 'collapsed'), [scenario]);
  const event: HistoryEventV2 = {
    ...historyFixture,
    changes: scenario === 'empty' ? [] : historyFixture.changes,
    reason: scenario === 'long-text' ? longText.repeat(4) : historyFixture.reason,
  };
  return (
    <Preview message={message}>
      <HistoryEntry
        event={event}
        operationLabel="更新物品记录"
        objectLabel={scenario === 'long-text' ? longText.repeat(2) : '厨房的这一件燕麦饮'}
        actorLabel={scenario === 'unknown' ? null : '小林'}
        familyTimezone={
          scenario === 'unknown' || scenario === 'no-timezone' ? null : 'Asia/Shanghai'
        }
        expanded={expanded}
        onExpandedChange={(next) => {
          setExpanded(next);
          log(next ? '已展开变更前后值。' : '已收起变更前后值。');
        }}
        changesPresentation={
          scenario === 'redacted'
            ? {
                ...changeLabels,
                'lifecycle.acquisition.batch_label': {
                  label: '购入批次',
                  before: { state: 'redacted' },
                  after: { state: 'redacted', reason: '当前权限不允许查看此字段。' },
                },
              }
            : changeLabels
        }
        state={scenario === 'loading' || scenario === 'error' ? scenario : 'ready'}
        onOpenTarget={(target) => log(`已收到查看对象意图：${target.id}。`)}
        correctionAvailability={
          scenario === 'readonly'
            ? { kind: 'readOnly', reason: '当前成员只能查看历史记录。' }
            : available
        }
        onCorrectionIntent={(entry) => log(`已收到更正申请意图：${entry.id}。未修改任何历史记录。`)}
      />
    </Preview>
  );
}

export const historyChangesScenarios = scenarios(
  ['normal', '前后值对比'],
  ['empty', '没有字段变更'],
  ['unknown', '存在但值未知'],
  ['redacted', '受限内容'],
  ['mixed', '多个值'],
  ['unrecorded', '未记录、空值与零'],
  ['loading', '读取中'],
  ['error', '读取失败'],
  ['long-text', '长值与路径'],
);
export function HistoryChangesDemo({ scenario }: ReviewDemoProps) {
  let changes = historyFixture.changes;
  let presentations = changeLabels;
  if (scenario === 'empty') changes = [];
  if (scenario === 'unknown')
    changes = [
      {
        path: 'contents.remaining',
        before_present: true,
        after_present: true,
        after: undefined,
        template_id: 'contents',
        template_version: 1,
      },
    ];
  if (scenario === 'unrecorded') {
    changes = [
      { path: 'zero', before_present: false, after_present: true, after: 0 },
      { path: 'null', before_present: true, after_present: true, before: null, after: '' },
      { path: 'boolean', before_present: true, after_present: true, before: false, after: true },
    ];
    presentations = {
      zero: { label: '未记录与零' },
      null: { label: '空值与空文本' },
      boolean: { label: '明确的否与是' },
    };
  }
  if (scenario === 'redacted')
    presentations = {
      ...changeLabels,
      'contents.remaining': {
        label: '剩余量',
        before: { state: 'redacted', reason: '此值不可见。' },
        after: { state: 'redacted' },
      },
    };
  if (scenario === 'mixed')
    presentations = {
      ...changeLabels,
      'contents.remaining': {
        label: '剩余量',
        before: { state: 'mixed' },
        after: { state: 'unknown', reason: '尚未取得完整变更结果。' },
      },
    };
  if (scenario === 'long-text') {
    changes = [
      {
        path: 'lifecycle.acquisition.batch_label',
        before_present: true,
        after_present: true,
        before: longText.repeat(3),
        after: longText.repeat(5),
        template_id: 'lifecycle',
        template_version: 1,
      },
    ];
  }
  return (
    <Preview>
      <HistoryChanges
        changes={changes}
        presentations={presentations}
        state={scenario === 'loading' || scenario === 'error' ? scenario : 'ready'}
      />
    </Preview>
  );
}

export const contentEntries: ReviewEntry[] = [
  {
    id: 'attribute-fields',
    name: '属性字段',
    group: '编辑与历史',
    description: 'AttributeFields · 固定模板版本、物品或商品范围、逐字段受控修改与未知值保留。',
    component: AttributeFieldsDemo,
    scenarios: attributeFieldsScenarios,
    storyId: 'rc1-content--attribute-fields',
    limitations: '值和数量为展示草稿；命令校验、完整模板升级由外部控制器负责。',
  },
  {
    id: 'note-editor',
    name: '备注编辑',
    group: '编辑与历史',
    description: 'NoteEditor · 物品范围的自由备注、受控草稿与安全预览。',
    component: NoteEditorDemo,
    scenarios: noteEditorScenarios,
    storyId: 'rc1-content--note-editor',
    limitations: '保存仅为意图；Markdown 预览不加载图片或打开链接。',
  },
  {
    id: 'attachment-list',
    name: '附件列表',
    group: '编辑与历史',
    description: 'AttachmentList · 真实附件读模型、处理状态与受限内容。',
    component: AttachmentListDemo,
    scenarios: attachmentListScenarios,
    storyId: 'rc1-content--attachment-list',
    limitations: '打开与移除由调用方处理；样例没有真实附件资源。',
  },
  {
    id: 'attachment-field',
    name: '附件选择',
    group: '编辑与历史',
    description: 'AttachmentField · 明确能力边界、手动选择与结果未知保留。',
    component: AttachmentFieldDemo,
    scenarios: attachmentFieldScenarios,
    storyId: 'rc1-content--attachment-field',
    limitations: '只传出所选 File 对象，不读取文件、生成资源地址或上传。',
  },
  {
    id: 'history-entry',
    name: '历史记录',
    group: '编辑与历史',
    description: 'HistoryEntry · 真实事件、完整对象身份、家庭时区与更正意图。',
    component: HistoryEntryDemo,
    scenarios: historyEntryScenarios,
    storyId: 'rc1-content--history-entry',
    limitations: '姓名、操作名称及更正权限由调用方提供，不执行撤销。',
  },
  {
    id: 'history-changes',
    name: '变更对比',
    group: '编辑与历史',
    description: 'HistoryChanges · 保留字段存在性、未知、受限和模板版本的前后对比。',
    component: HistoryChangesDemo,
    scenarios: historyChangesScenarios,
    storyId: 'rc1-content--history-changes',
    limitations: '脱敏说明由上层显式传入；不推测缺失的前后值。',
  },
];
