import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import { Button } from '../../../ui/components/ui/button';
import { Input } from '../../../ui/components/ui/input';
import { Textarea } from '../../../ui/components/ui/textarea';
import { FormField } from '../../../ui/components/ui/form-field';
import { RadioGroup } from '../../../ui/components/ui/radio-group';
import { Select } from '../../../ui/components/ui/select';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import { Badge } from '../../../ui/components/ui/badge';
import { PageHeader } from '../../../ui/patterns/page-header';
import { DateFactField } from '../../../ui/patterns/date-fact-field';
import { DateFactValue } from '../../../ui/patterns/date-fact-value';
import { NoteEditor, type NoteDraft } from '../../../ui/patterns/note-editor';
import { AttachmentField, type AttachmentFieldProps } from '../../../ui/patterns/attachment-field';
import { AttachmentList, type AttachmentListProps } from '../../../ui/patterns/attachment-list';
import { ScanInput, type ScanInputProps } from '../../../ui/patterns/scan-input';
import { LabelPrintPanel, type LabelPrintPanelProps } from '../../../ui/patterns/label-print-panel';
import { OperationSheet } from '../../../ui/patterns/operation-sheet';
import {
  ConflictResolution,
  type ConflictResolutionProps,
} from '../../../ui/patterns/conflict-resolution';
import { CapabilityNotice } from '../../../ui/patterns/capability-notice';
import { LoadingState } from '../../../ui/patterns/loading-state';
import { EmptyState } from '../../../ui/patterns/empty-state';
import type {
  ActionAvailability,
  DateFactPresentation,
  OperationState,
} from '../../../ui/patterns/types';
import './daily-pages.css';
import './daily-extras.css';

export type DailyExtraSurface = 'opening' | 'dates' | 'notes' | 'attachments' | 'scan' | 'labels';
export type DailyExtraReadState = 'ready' | 'loading' | 'error' | 'forbidden' | 'not-found';
export interface ExtraContext {
  itemId: string;
  itemLabel: string;
  productLabel: string;
  locationLabel: string;
  revision: number;
  timezone: string | null;
  today: string;
}
export interface ExtraMutation {
  open: boolean;
  state: OperationState;
  taskId: string;
  summary: readonly string[];
  error?: string;
  receipt?: string;
  availability: ActionAvailability;
  conflict?: ConflictResolutionProps;
  onReview: () => void;
  onSubmit: () => void;
  onRecover: () => void;
  onClose: () => void;
  onEdit: () => void;
}
export interface OpeningDraft {
  intent: 'now' | 'backdate' | 'unknown' | 'correct';
  localTime: string;
  timezone: string;
}
export interface OpeningModel {
  draft: OpeningDraft;
  onChange: (draft: OpeningDraft) => void;
  currentState: string;
  openedAt: string | null;
  nowLabel: string;
  afterOpeningDays: number | null;
  mutation: ExtraMutation;
}
export interface DatesModel {
  facts: readonly DateFactPresentation[];
  selected: number;
  draft: DateFactPresentation;
  onSelect: (index: number) => void;
  onChange: (draft: DateFactPresentation) => void;
  onAdd: (kind: DateFactPresentation['kind']) => void;
  month: string;
  onMonthChange: (month: string) => void;
  completedOn: string;
  onCompletedOnChange: (value: string) => void;
  completing: boolean;
  onCompletingChange: (value: boolean) => void;
  recurring: boolean;
  mutation: ExtraMutation;
}
export interface ExtraNote {
  id: string;
  title: string | null;
  excerpt: string;
  scope: 'item' | 'product';
  redacted?: boolean;
}
export interface NotesModel {
  scope: 'item' | 'product';
  onScopeChange: (scope: 'item' | 'product') => void;
  notes: readonly ExtraNote[];
  selectedId: string | null;
  draft: NoteDraft;
  onChange: (draft: NoteDraft) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  mode: 'edit' | 'preview';
  onModeChange: (mode: 'edit' | 'preview') => void;
  dirty: boolean;
  redacted: boolean;
  mutation: ExtraMutation;
  onAttachments: () => void;
  onRecordFacts: () => void;
}
export interface AttachmentTransfer {
  id: string;
  disabled?: boolean;
  name: string;
  state: 'uploaded' | 'unknown';
  onAssociate: () => void;
  onRecover: () => void;
}
export interface AttachmentsModel {
  scopeLabel: string;
  samples?: readonly { id: string; label: string; description: string }[];
  onChooseSample?: (id: string) => void;
  sampleSelectionDisabled?: boolean;
  showField?: boolean;
  preview?: ReactNode;
  onClosePreview?: () => void;
  preparedLabel?: string;
  field: AttachmentFieldProps;
  list: AttachmentListProps;
  transfers: readonly AttachmentTransfer[];
  quotaLabel: string;
  message?: string;
  webPath?: string;
  onContinueWeb?: () => void;
  removeName?: string;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}
export interface ScanModel {
  input: ScanInputProps;
  products: readonly { id: string; name: string; details: string }[];
  onProduct: (id: string) => void;
  onIntake: (id: string) => void;
  onSearch: () => void;
  examples: readonly { label: string; value: string }[];
  onExample: (value: string) => void;
  cameraMessage?: string;
}
export interface LabelsModel {
  panel: LabelPrintPanelProps;
  available: readonly { id: string; name: string; location: string }[];
  onToggle: (id: string) => void;
  inspectPageId: string | null;
  onCloseInspect: () => void;
  onReprint: (id: string) => void;
  paper: string;
  onPaperChange: (value: string) => void;
  onContinueWeb?: () => void;
  controls?: ReactNode;
}
interface ExtraBase {
  context: ExtraContext;
  readState: DailyExtraReadState;
  onRetry: () => void;
  onBack: () => void;
  onNavigate: (surface: DailyExtraSurface) => void;
}
export type DailyExtrasProps = ExtraBase &
  (
    | { surface: 'opening'; model: OpeningModel }
    | { surface: 'dates'; model: DatesModel }
    | { surface: 'notes'; model: NotesModel }
    | { surface: 'attachments'; model: AttachmentsModel }
    | { surface: 'scan'; model: ScanModel }
    | { surface: 'labels'; model: LabelsModel }
  );
const titles: Record<DailyExtraSurface, string> = {
  opening: '开封记录',
  dates: '日期与期限',
  notes: '笔记',
  attachments: '照片与附件',
  scan: '扫码识别',
  labels: '物品标签',
};
const dateNames: Record<DateFactPresentation['kind'], string> = {
  EXPIRY: '包装日期',
  WARRANTY_END: '保修结束',
  SERVICE_DUE: '保养日期',
  RETURN_BY: '归还期限',
  RENEWAL: '续期日期',
  REORDER_BY: '补货日期',
};
function MutationPanel({
  mutation,
  title,
  scope,
}: {
  mutation: ExtraMutation;
  title: string;
  scope: string;
}) {
  const locked = mutation.availability.kind !== 'available';
  return (
    <>
      {mutation.availability.kind !== 'available' && (
        <CapabilityNotice capabilityLabel={title} availability={mutation.availability} />
      )}
      {mutation.receipt && (
        <InlineNotice tone="success" title="已保存本次记录">
          {mutation.receipt}
        </InlineNotice>
      )}
      <div className="vn-row">
        <Button
          disabled={locked || mutation.state === 'networkUnknown' || mutation.state === 'success'}
          onClick={mutation.onReview}
        >
          核对并保存
        </Button>
        {mutation.state === 'networkUnknown' && (
          <Button variant="secondary" onClick={mutation.onReview}>
            查看待确认请求
          </Button>
        )}
        {mutation.state === 'success' && (
          <Button variant="secondary" onClick={mutation.onEdit}>
            继续编辑
          </Button>
        )}
        <span className="vn-muted">离开此页会保留草稿</span>
      </div>
      <OperationSheet
        open={mutation.open}
        operation={{
          taskId: mutation.taskId,
          title,
          scopeLabel: scope,
          state: mutation.state,
          closePolicy: 'retain',
        }}
        onAction={(action) => (action === 'recover' ? mutation.onRecover() : mutation.onSubmit())}
        onClose={mutation.onClose}
        onRetainAndClose={mutation.onClose}
        actions={
          mutation.state === 'networkUnknown'
            ? [{ id: 'recover', label: '核对原请求结果', kind: 'read' }]
            : mutation.state === 'success' || mutation.state === 'revisionConflict'
              ? []
              : [{ id: 'submit', label: '确认保存', kind: 'submit', disabled: locked }]
        }
        recoveryContent={
          mutation.state === 'revisionConflict' && mutation.conflict ? (
            <ConflictResolution {...mutation.conflict} />
          ) : undefined
        }
      >
        <div className="vn-extra-stack">
          <ul className="vn-extra-summary">
            {mutation.summary.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
          {mutation.error && (
            <InlineNotice tone="danger" title="尚未保存">
              {mutation.error}
            </InlineNotice>
          )}
          {mutation.state === 'networkUnknown' && (
            <InlineNotice tone="warning" title="保存结果待确认">
              输入已冻结；核对仍使用原请求，不创建第二次操作。
            </InlineNotice>
          )}
          {mutation.receipt && (
            <InlineNotice tone="success" title="结果已取得">
              {mutation.receipt}
            </InlineNotice>
          )}
        </div>
      </OperationSheet>
    </>
  );
}
function Opening({ context, model }: { context: ExtraContext; model: OpeningModel }) {
  const { draft, mutation } = model;
  const locked =
    mutation.availability.kind !== 'available' ||
    mutation.state === 'networkUnknown' ||
    mutation.state === 'success';
  const opened = model.currentState === '已开封';
  return (
    <div className="vn-extra-stack">
      <section className="vn-extra-card">
        <h2>当前开封记录</h2>
        <p>
          {model.currentState} · {model.openedAt || '开封时间未记录'}
        </p>
        <p className="vn-muted">家庭时区：{context.timezone || '未设置'}</p>
      </section>
      <RadioGroup
        label="这次要记录什么"
        value={draft.intent}
        disabled={locked}
        showOptionDescriptions
        orientation="vertical"
        onValueChange={(intent) =>
          model.onChange({ ...draft, intent: intent as OpeningDraft['intent'] })
        }
        options={
          opened
            ? [
                {
                  value: 'correct',
                  label: '修正已有开封记录',
                  description: '更正此件资料，保留原记录的追溯关系。',
                },
              ]
            : [
                {
                  value: 'now',
                  label: '现在开封',
                  description: `点击最终确认时记录：${model.nowLabel}`,
                },
                {
                  value: 'backdate',
                  label: '补记开封时间',
                  description: '填写实际时间和对应时区。',
                },
                {
                  value: 'unknown',
                  label: '已开封，时间不知道',
                  description: '只记录已开封；开封时间仍为未记录。',
                },
              ]
        }
      />
      {(draft.intent === 'backdate' || draft.intent === 'correct') && (
        <div className="vn-extra-grid">
          <FormField
            label="实际开封时间"
            hint={
              draft.intent === 'correct'
                ? '留空表示明确清除时间，保留已开封状态。'
                : '日期和时间都需要填写。'
            }
          >
            <Input
              type="datetime-local"
              value={draft.localTime}
              disabled={locked}
              onChange={(event) => model.onChange({ ...draft, localTime: event.target.value })}
            />
          </FormField>
          <Select
            label="时间所属时区"
            value={draft.timezone}
            disabled={locked}
            onValueChange={(timezone) => timezone && model.onChange({ ...draft, timezone })}
            options={[
              { value: 'Asia/Shanghai', label: '中国标准时间 · UTC+08:00' },
              { value: 'UTC', label: '协调世界时 · UTC+00:00' },
              { value: 'Asia/Tokyo', label: '日本标准时间 · UTC+09:00' },
            ]}
          />
        </div>
      )}
      <InlineNotice announce={false} title="开封后期限的依据">
        {model.afterOpeningDays !== null
          ? `此件已记录开封后 ${model.afterOpeningDays} 天期限；只有开封时间也已记录时，才可计算日期。`
          : '尚未记录开封后期限，不从商品名称或购入日推算。'}
      </InlineNotice>
      <MutationPanel
        mutation={mutation}
        title={opened ? '修正开封记录' : '记录开封'}
        scope={`此件 · ${context.itemLabel}`}
      />
    </div>
  );
}
function Dates({ context, model }: { context: ExtraContext; model: DatesModel }) {
  const locked =
    model.mutation.availability.kind !== 'available' ||
    model.mutation.state === 'networkUnknown' ||
    model.mutation.state === 'success';
  return (
    <div className="vn-extra-stack">
      <section className="vn-extra-card">
        <h2>每条日期保留各自含义</h2>
        <div className="vn-extra-date-list">
          {model.facts.map((fact, index) => (
            <button
              type="button"
              className="vn-extra-date-row"
              key={`${fact.kind}:${index}`}
              aria-pressed={model.selected === index}
              disabled={locked}
              onClick={() => model.onSelect(index)}
            >
              <strong>{fact.label || dateNames[fact.kind]}</strong>
              <DateFactValue fact={fact} compact />
              <span className="vn-muted">
                {fact.source === 'LIFECYCLE' ? '包装 / 生命周期记录' : '独立期限'} ·{' '}
                {fact.basis || '依据未记录'}
              </span>
            </button>
          ))}
        </div>
        {!model.facts.length && <p className="vn-muted">没有已记录的日期。空值不代表无期限。</p>}
        <Select
          label="添加一条期限"
          value=""
          disabled={locked}
          onValueChange={(kind) => model.onAdd(kind as DateFactPresentation['kind'])}
          options={[
            { value: '', label: '选择期限类型' },
            ...(['WARRANTY_END', 'SERVICE_DUE', 'RETURN_BY', 'RENEWAL', 'REORDER_BY'] as const).map(
              (kind) => ({ value: kind, label: dateNames[kind] }),
            ),
          ]}
        />
      </section>
      <DateFactField
        fact={model.draft}
        onChange={model.onChange}
        timezone={context.timezone}
        month={model.month}
        onMonthChange={model.onMonthChange}
        today={context.today}
        disabled={locked || model.completing}
      />
      <div className="vn-row">
        <Button
          variant="quiet"
          disabled={locked || model.completing}
          onClick={() =>
            model.onChange({ ...model.draft, dueOn: null, dateKind: null, basis: null })
          }
        >
          明确清除这条日期
        </Button>
      </div>
      {model.draft.kind !== 'EXPIRY' && (
        <section className="vn-extra-card">
          <RadioGroup
            label="本次操作"
            value={model.completing ? 'complete' : 'edit'}
            disabled={locked}
            onValueChange={(value) => model.onCompletingChange(value === 'complete')}
            options={[
              { value: 'edit', label: '编辑期限' },
              {
                value: 'complete',
                label: '记录本次完成',
                disabled: model.draft.state === 'COMPLETED',
              },
            ]}
          />
          {model.completing && (
            <FormField
              label="本次完成日期"
              hint={model.recurring ? '下一日期将在保存回执中显示。' : '完成后保留本次历史。'}
            >
              <Input
                type="date"
                value={model.completedOn}
                disabled={locked}
                onChange={(event) => model.onCompletedOnChange(event.target.value)}
              />
            </FormField>
          )}
        </section>
      )}
      <MutationPanel
        mutation={model.mutation}
        title={model.completing ? '完成期限事项' : '保存日期事实'}
        scope={`此件 · ${context.itemLabel}`}
      />
    </div>
  );
}
function Notes({ context, model }: { context: ExtraContext; model: NotesModel }) {
  const locked =
    model.mutation.availability.kind !== 'available' ||
    model.mutation.state === 'networkUnknown' ||
    model.mutation.state === 'success';
  return (
    <div className="vn-extra-stack">
      <RadioGroup
        label="笔记作用对象"
        value={model.scope}
        disabled={model.mutation.state === 'networkUnknown'}
        onValueChange={(scope) => model.onScopeChange(scope as NotesModel['scope'])}
        showOptionDescriptions
        options={[
          { value: 'item', label: '仅此件', description: context.itemLabel },
          { value: 'product', label: '商品共有', description: context.productLabel },
        ]}
      />
      <div className="vn-extra-grid vn-extra-notes">
        <section className="vn-extra-card">
          <div className="vn-row">
            <h2>{model.scope === 'item' ? '这件的笔记' : '商品公共说明'}</h2>
            <Button variant="secondary" disabled={locked} onClick={model.onCreate}>
              新建笔记
            </Button>
          </div>
          {model.notes
            .filter((note) => note.scope === model.scope)
            .map((note) => (
              <button
                type="button"
                className="vn-extra-note-row"
                key={note.id}
                aria-pressed={model.selectedId === note.id}
                disabled={model.mutation.state === 'networkUnknown'}
                onClick={() => model.onSelect(note.id)}
              >
                <strong>{note.title || '无标题笔记'}</strong>
                <span>{note.redacted ? '已隐藏 · 当前权限不能披露' : note.excerpt}</span>
              </button>
            ))}
          {!model.notes.some((note) => note.scope === model.scope) && (
            <p className="vn-muted">还没有此范围的笔记。</p>
          )}
        </section>
        <div className="vn-extra-stack">
          {model.scope === 'item' ? (
            <NoteEditor
              itemId={context.itemId}
              itemLabel={context.itemLabel}
              value={model.draft}
              onChange={model.onChange}
              mode={model.mode}
              onModeChange={model.onModeChange}
              availability={model.mutation.availability}
              dirty={model.dirty}
              readOnly={locked}
              redacted={model.redacted}
              previewFormat="markdown"
            />
          ) : (
            <section className="vn-extra-card">
              <h2>商品公共说明</h2>
              <p className="vn-muted">影响这款商品的公共说明；与单件笔记分别保存。</p>
              <RadioGroup
                label="公共说明视图"
                value={model.mode}
                onValueChange={(value) => model.onModeChange(value as 'edit' | 'preview')}
                options={[
                  { value: 'edit', label: '编辑' },
                  { value: 'preview', label: '预览' },
                ]}
              />
              {model.redacted ? (
                <InlineNotice title="已隐藏">当前权限不能查看或修改正文。</InlineNotice>
              ) : model.mode === 'preview' ? (
                <div className="vn-content-prose">
                  <h3>{model.draft.title || '无标题说明'}</h3>
                  <Markdown
                    skipHtml
                    disallowedElements={['img']}
                    unwrapDisallowed
                    components={{ a: ({ children }) => <span>{children}</span> }}
                  >
                    {model.draft.body || '尚未填写正文。'}
                  </Markdown>
                </div>
              ) : (
                <>
                  <FormField label="标题（选填）">
                    <Input
                      value={model.draft.title || ''}
                      disabled={locked}
                      onChange={(event) =>
                        model.onChange({ ...model.draft, title: event.target.value || null })
                      }
                    />
                  </FormField>
                  <FormField label="Markdown 正文">
                    <Textarea
                      rows={8}
                      value={model.draft.body || ''}
                      disabled={locked}
                      onChange={(event) =>
                        model.onChange({ ...model.draft, body: event.target.value })
                      }
                    />
                  </FormField>
                </>
              )}
            </section>
          )}
          <MutationPanel
            mutation={model.mutation}
            title="保存笔记"
            scope={`${model.scope === 'item' ? '仅此件' : '商品共有'} · ${model.scope === 'item' ? context.itemLabel : context.productLabel}`}
          />
        </div>
      </div>
      <div className="vn-row">
        <Button variant="secondary" onClick={model.onAttachments}>
          查看附件
        </Button>
        <Button variant="quiet" onClick={model.onRecordFacts}>
          记录为日期资料
        </Button>
      </div>
      <p className="vn-muted">笔记正文不会自动变成日期、余量等事实；记录为资料时需要重新核对。</p>
    </div>
  );
}
function Attachments({ model }: { model: AttachmentsModel }) {
  return (
    <div className="vn-extra-stack">
      <InlineNotice announce={false} title={model.scopeLabel}>
        JPEG / PNG / WebP / PDF · 每个文件最多 25 MiB · 每个目标最多 20 个有效附件 · 家庭总容量 5
        GiB。{model.quotaLabel}
      </InlineNotice>
      {model.samples && (
        <section className="vn-extra-card">
          <h2>选择内置样例附件</h2>
          <p className="vn-muted">样例仅保存在本地试用数据中。</p>
          <div className="vn-row">
            {model.samples.map((sample) => (
              <Button
                key={sample.id}
                variant="secondary"
                disabled={model.sampleSelectionDisabled}
                onClick={() => model.onChooseSample?.(sample.id)}
                title={sample.description}
              >
                {sample.label}
              </Button>
            ))}
          </div>
        </section>
      )}
      <AttachmentList {...model.list} />
      {model.preview && (
        <section className="vn-extra-card" aria-label="附件预览">
          {model.preview}
          <Button variant="quiet" onClick={model.onClosePreview}>
            关闭预览
          </Button>
        </section>
      )}
      {model.showField !== false && <AttachmentField {...model.field} />}
      {model.transfers.map((transfer) => (
        <section className="vn-extra-card" key={transfer.id}>
          <h2>{transfer.name}</h2>
          <Badge variant={transfer.state === 'unknown' ? 'warning' : 'info'}>
            {transfer.state === 'unknown'
              ? '关联结果未知'
              : model.preparedLabel || '上传完成，尚未关联'}
          </Badge>
          <p>
            {transfer.state === 'unknown'
              ? '保留原上传引用，先核对关联结果。'
              : '文件尚未成为已保存附件，确认关联后才会显示在列表中。'}
          </p>
          <Button
            variant="secondary"
            disabled={transfer.disabled}
            onClick={transfer.state === 'unknown' ? transfer.onRecover : transfer.onAssociate}
          >
            {transfer.state === 'unknown' ? '核对原关联结果' : '关联到当前对象'}
          </Button>
          <details>
            <summary>上传引用</summary>
            <code>{transfer.id}</code>
          </details>
        </section>
      ))}
      {model.message && <InlineNotice title="附件处理记录">{model.message}</InlineNotice>}
      {model.onContinueWeb && (
        <Button variant="secondary" onClick={model.onContinueWeb}>
          在网站继续
        </Button>
      )}
      {model.webPath && <p className="vn-muted">将保留当前对象：{model.webPath}</p>}
      <OperationSheet
        open={!!model.removeName}
        operation={{
          taskId: 'attachment-remove',
          state: 'draft',
          title: '移除附件关联',
          scopeLabel: model.scopeLabel,
          closePolicy: 'allow',
        }}
        actions={[{ id: 'remove', label: '确认移除关联', kind: 'submit', variant: 'danger' }]}
        onAction={model.onConfirmRemove}
        onClose={model.onCancelRemove}
        onRetainAndClose={model.onCancelRemove}
      >
        <p>将从此对象移除「{model.removeName}」的附件关联。</p>
      </OperationSheet>
    </div>
  );
}
function Scan({ model }: { model: ScanModel }) {
  return (
    <div className="vn-extra-stack">
      <p>识别物品标签时查看明确的一件；商品条码先确认商品，再选择实物。</p>
      <ScanInput {...model.input} />
      {model.cameraMessage && <InlineNotice title="相机状态">{model.cameraMessage}</InlineNotice>}
      {model.products.length > 0 && (
        <section className="vn-extra-card">
          <h2>对应商品</h2>
          {model.products.map((product) => (
            <article className="vn-extra-stack" key={product.id}>
              <strong>{product.name}</strong>
              <p className="vn-muted">{product.details}</p>
              <div className="vn-row">
                <Button variant="secondary" onClick={() => model.onProduct(product.id)}>
                  查看这款商品
                </Button>
                <Button variant="quiet" onClick={() => model.onIntake(product.id)}>
                  再添这款
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}
      <div className="vn-row">
        <Button variant="quiet" onClick={model.onSearch} disabled={!model.input.rawText.trim()}>
          保留文字并搜索
        </Button>
      </div>
      <details className="vn-extra-card">
        <summary>试用识别样例</summary>
        <div className="vn-row">
          {model.examples.map((example) => (
            <Button
              variant="secondary"
              key={example.label}
              onClick={() => model.onExample(example.value)}
            >
              {example.label}
            </Button>
          ))}
        </div>
      </details>
    </div>
  );
}
function Labels({ model }: { model: LabelsModel }) {
  const frozen = model.panel.pages.some((page) => page.status !== 'not-sent');
  return (
    <div className="vn-extra-stack">
      <section className="vn-extra-card">
        <h2>选择要打印的实物</h2>
        <div className="vn-extra-selection">
          {model.available.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={model.panel.selectedItemIds.includes(item.id)}
                disabled={frozen}
                onChange={() => model.onToggle(item.id)}
              />
              <span>
                <strong>{item.name}</strong>
                <span>{item.location}</span>
              </span>
            </label>
          ))}
        </div>
      </section>
      <Select
        label="纸张尺寸"
        value={model.paper}
        onValueChange={(value) => value && model.onPaperChange(value)}
        disabled={frozen}
        options={[
          { value: '30x12', label: '30 × 12 mm' },
          { value: '40x30', label: '40 × 30 mm' },
        ]}
      />
      {model.controls}
      <LabelPrintPanel {...model.panel} />
      {model.onContinueWeb && (
        <Button variant="secondary" onClick={model.onContinueWeb}>
          携带所选物品在支持的网站继续
        </Button>
      )}
      <OperationSheet
        open={!!model.inspectPageId}
        operation={{
          taskId: model.inspectPageId || 'print-inspection',
          state: 'draft',
          title: '核对这张标签',
          description: '重打只生成标签，不改变库存。',
          closePolicy: 'allow',
        }}
        actions={[{ id: 'reprint', label: '已核对，明确重打此页', kind: 'submit' }]}
        onAction={() => model.inspectPageId && model.onReprint(model.inspectPageId)}
        onClose={model.onCloseInspect}
        onRetainAndClose={model.onCloseInspect}
      >
        <InlineNotice tone="warning" title="先检查设备和纸张">
          当前页可能已出纸。只有确认需要重打时才发送；关闭面板会继续保留未知状态。
        </InlineNotice>
      </OperationSheet>
    </div>
  );
}
/** Controlled business presentation. All storage, fixture data, transports and simulations live in the caller. */
export function DailyExtras(props: DailyExtrasProps) {
  const content =
    props.readState === 'loading' ? (
      <LoadingState label="正在读取此对象资料" />
    ) : props.readState === 'error' ? (
      <InlineNotice
        tone="danger"
        title="资料读取失败"
        action={
          <Button variant="secondary" onClick={props.onRetry}>
            重新读取
          </Button>
        }
      >
        没有把读取失败解释为无记录，草稿仍保留。
      </InlineNotice>
    ) : props.readState === 'forbidden' ? (
      <InlineNotice tone="warning" title="当前家庭无法访问此物品">
        请从当前家庭的物品列表重新选择，不披露其他家庭资料。
      </InlineNotice>
    ) : props.readState === 'not-found' ? (
      <EmptyState reason="empty" title="没有找到此对象" context="返回物品列表选择明确的一件。" />
    ) : props.surface === 'opening' ? (
      <Opening context={props.context} model={props.model} />
    ) : props.surface === 'dates' ? (
      <Dates context={props.context} model={props.model} />
    ) : props.surface === 'notes' ? (
      <Notes context={props.context} model={props.model} />
    ) : props.surface === 'attachments' ? (
      <Attachments model={props.model} />
    ) : props.surface === 'scan' ? (
      <Scan model={props.model} />
    ) : (
      <Labels model={props.model} />
    );
  return (
    <section className="vn-daily-page vn-daily-extras">
      <PageHeader
        title={titles[props.surface]}
        onBack={props.onBack}
        context={
          props.readState === 'ready' && props.surface !== 'scan' && props.surface !== 'labels' ? (
            <>
              {props.context.itemLabel} · {props.context.locationLabel}
            </>
          ) : undefined
        }
      />
      <nav className="vn-extra-nav" aria-label="物品补充操作">
        {Object.entries(titles).map(([surface, label]) => (
          <Button
            key={surface}
            variant={surface === props.surface ? 'secondary' : 'quiet'}
            aria-current={surface === props.surface ? 'page' : undefined}
            onClick={() => props.onNavigate(surface as DailyExtraSurface)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {content}
    </section>
  );
}
