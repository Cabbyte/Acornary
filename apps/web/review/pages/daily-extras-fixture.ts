// Private isolated fixture adapter. Never imported by a production bootstrap.
import { useSyncExternalStore } from 'react';
import type { OpeningDraft, ExtraNote } from '../../src/features/daily/pages/daily-extras';
import type { NoteDraft } from '../../src/ui/patterns/note-editor';
import type { PendingAttachment } from '../../src/ui/patterns/attachment-field';
import type { ScanResult } from '../../src/ui/patterns/scan-input';
import type { PrintPagePresentation } from '../../src/ui/patterns/label-print-panel';
import type {
  ActionAvailability,
  AttachmentView,
  DateFactPresentation,
  NoteView,
  OperationState,
} from '../../src/ui/patterns/types';
import type { DailyItemFacts } from '../../src/features/daily/pages/models';
import { notes as initialNotes, history as baseHistory } from './fixtures';
import { trialInstant, trialToday } from '../trial/clock';
import {
  reviewStorage,
  flushReviewStorage,
  runReviewTransaction,
  assertTrialWrite,
} from '../trial/storage';
import { getTrialScope, subscribeTrialScope, isTrial } from '../trial/session';
import { getReviewWorld, updateReviewItems, appendReviewEvent } from './inventory-session';
import { DailyTaskController, dailyCommand } from '../../src/app-vnext/daily-tasks';
import {
  validateCommandAttempt,
  type OperationRecord,
} from '../../src/app-vnext/operation-session';
import type { CommandAttempt } from '../../src/app-vnext/platform';
import { sameGeneration, type ApplicationScope } from '../../src/app-vnext/scope';
import { getFixtureScope } from '../trial/application';
import { getManagementCatalogs, updateManagementCatalogRevision } from './management-storage';
import {
  commandFor,
  requestTarget,
  validDailyFixtureRecord,
  validState,
} from './daily-extras-journal';
export const available: ActionAvailability = { kind: 'available' };
export const blankDate: DateFactPresentation = {
  kind: 'EXPIRY',
  dateKind: null,
  dueOn: null,
  basis: null,
  state: 'UNKNOWN',
  source: 'LIFECYCLE',
  label: '包装日期',
};
const dateKindLabels = { USE_BY: '限用日期', BEST_BEFORE: '最佳食用期', ESTIMATED: '估计日期' };
export const dateLabels: Record<DateFactPresentation['kind'], string> = {
  EXPIRY: '包装日期',
  WARRANTY_END: '保修结束',
  SERVICE_DUE: '保养日期',
  RETURN_BY: '归还期限',
  RENEWAL: '续期日期',
  REORDER_BY: '补货日期',
};
export const uniqueId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export const dateSummary = (fact: DateFactPresentation) =>
  `${fact.kind === 'EXPIRY' ? (fact.dateKind ? dateKindLabels[fact.dateKind] : '类型未记录') : dateLabels[fact.kind]} · ${fact.dueOn || '日期未记录'} · ${fact.basis || '依据未记录'}`;
export type EditSurface = 'opening' | 'dates' | 'notes';
export interface NoteRecord extends ExtraNote {
  body?: string;
  revision: number;
}
export interface Transfer {
  scope: 'item' | 'product';
  id: string;
  localId: string;
  name: string;
  size: number;
  mime: string;
  sampleId?: string;
  state: 'uploaded' | 'unknown';
}
export interface RequestSnapshot {
  key: string;
  target?: { kind: 'ITEM' | 'CATALOG_NODE'; id: string };
  accountId?: string;
  householdId?: string;
  revision: number;
  targetRevision: number;
  summary: string[];
  opening?: OpeningDraft;
  date?: DateFactPresentation;
  dateIndex?: number;
  completing?: boolean;
  completedOn?: string;
  note?: NoteDraft;
  noteId?: string;
  scope?: 'item' | 'product';
}
export interface MutationState {
  baseRevision?: number;
  open: boolean;
  state: OperationState;
  error: string;
  receipt: string;
  request: RequestSnapshot | null;
  resolved?: boolean;
  choice?: 'current' | 'input';
}
export interface ReviewState {
  opening: OpeningDraft;
  openingState: string;
  openedAt: string | null;
  facts: DateFactPresentation[];
  dateDraft: DateFactPresentation;
  dateIndex: number;
  month: string;
  completing: boolean;
  completedOn: string;
  notes: NoteRecord[];
  noteDrafts: Record<string, NoteDraft>;
  selectedNotes: Record<'item' | 'product', string>;
  scope: 'item' | 'product';
  productId: string | null;
  noteMode: 'edit' | 'preview';
  mutations: Record<EditSurface, MutationState>;
  attachments: AttachmentView[];
  attachmentNames: Record<string, string>;
  attachmentLocalIds: Record<string, string>;
  pending: Array<PendingAttachment & { scope?: 'item' | 'product'; sampleId?: string }>;
  transfers: Transfer[];
  attachmentMessage: string;
  scanText: string;
  scanResult: ScanResult;
  scanSelected: string | null;
  cameraMessage: string;
  selectedLabels: string[];
  pages: PrintPagePresentation[];
  queue: string[];
  paper: string;
  connection: 'disconnected' | 'connected';
  printFailure: boolean;
}
const noteStoreKey = 'acornary-review-extra-notes-v1';
let noteStore: Record<string, NoteView[]> | null = null;
let noteStoreScope = '';
let noteStoreRaw: string | null = null;
export const scopeKey = () => {
  const scope = getTrialScope();
  return `${scope.accountId}:${scope.householdId}:${scope.generation}`;
};
const noteListeners = new Set<() => void>();
function readNoteStore() {
  const currentScope = scopeKey();
  let raw: string | null = null;
  try {
    raw = reviewStorage.getItem(noteStoreKey);
  } catch {
    /* reading initial examples remains possible */
  }
  if (!noteStore || noteStoreScope !== currentScope || noteStoreRaw !== raw) {
    try {
      noteStore = JSON.parse(raw || '{}');
    } catch {
      noteStore = {};
    }
    noteStoreScope = currentScope;
    noteStoreRaw = raw;
  }
  return noteStore!;
}
export function getExtraReviewNotes(targetId: string): NoteView[] | undefined {
  return readNoteStore()[targetId];
}
export function useExtraReviewNotes(targetId: string): NoteView[] | undefined {
  return useSyncExternalStore(
    (listener) => {
      noteListeners.add(listener);
      const unsubscribe = subscribeTrialScope(listener);
      window.addEventListener('storage', listener);
      return () => {
        noteListeners.delete(listener);
        unsubscribe();
        window.removeEventListener('storage', listener);
      };
    },
    () => getExtraReviewNotes(targetId),
    () => undefined,
  );
}
export function publishNotes(
  targetId: string,
  notes: NoteRecord[],
  scope: 'item' | 'product',
  modifiedId?: string,
) {
  const ownNotes: NoteView[] = notes
    .filter((note) => note.scope === scope)
    .map((note) => ({
      id: note.id,
      itemId: targetId,
      title: note.title,
      excerpt: note.redacted ? '已隐藏' : note.excerpt,
      body: note.redacted ? undefined : note.body,
      updatedAt: trialInstant(),
      sensitivity: 'NORMAL',
    }));
  const current = readNoteStore()[targetId] || ownNotes;
  const merged = modifiedId
    ? [
        ...current.filter((note) => note.id !== modifiedId),
        ...ownNotes.filter((note) => note.id === modifiedId),
      ]
    : ownNotes;
  const next = { ...readNoteStore(), [targetId]: merged };
  reviewStorage.setItem(noteStoreKey, JSON.stringify(next));
  noteStore = next;
  noteStoreScope = scopeKey();
  noteStoreRaw = JSON.stringify(next);
  noteListeners.forEach((listener) => listener());
}
export interface StoredAttachment extends AttachmentView {
  name: string;
  localId: string;
  sampleId?: string;
}
const attachmentStoreKey = 'acornary-review-extra-attachments-v1';
let attachmentStore: Record<string, StoredAttachment[]> | null = null;
let attachmentStoreScope = '';
let attachmentStoreRaw: string | null = null;
export function readAttachmentStore() {
  const currentScope = scopeKey();
  let raw: string | null = null;
  try {
    raw = reviewStorage.getItem(attachmentStoreKey);
  } catch {
    /* initial metadata stays readable */
  }
  if (!attachmentStore || attachmentStoreScope !== currentScope || attachmentStoreRaw !== raw) {
    try {
      attachmentStore = JSON.parse(raw || '{}');
    } catch {
      attachmentStore = {};
    }
    attachmentStoreScope = currentScope;
    attachmentStoreRaw = raw;
  }
  return attachmentStore!;
}
export function getExtraReviewAttachments(targetId: string): StoredAttachment[] | undefined {
  return readAttachmentStore()[targetId];
}
export function useExtraReviewAttachments(targetId: string): StoredAttachment[] | undefined {
  return useSyncExternalStore(
    (listener) => {
      noteListeners.add(listener);
      const unsubscribe = subscribeTrialScope(listener);
      window.addEventListener('storage', listener);
      return () => {
        noteListeners.delete(listener);
        unsubscribe();
        window.removeEventListener('storage', listener);
      };
    },
    () => getExtraReviewAttachments(targetId),
    () => undefined,
  );
}
export function publishAttachments(targetId: string, records: StoredAttachment[]) {
  const next = { ...readAttachmentStore(), [targetId]: records };
  reviewStorage.setItem(attachmentStoreKey, JSON.stringify(next));
  attachmentStore = next;
  attachmentStoreScope = scopeKey();
  attachmentStoreRaw = JSON.stringify(next);
  noteListeners.forEach((listener) => listener());
}
export const samples = [
  {
    id: 'sample-label-photo',
    label: '包装标签样例 · PNG',
    description: '本地生成的示例包装标签，用于体验附件预览。',
  },
  {
    id: 'sample-guide-pdf',
    label: '使用说明样例 · PDF',
    description: '内置的一页 PDF，仅供试用下载。',
  },
];
export function sampleFile(id: string): File {
  if (id === 'sample-label-photo') {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 300;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f1f4ed';
    context.fillRect(0, 0, 480, 300);
    context.fillStyle = '#fff';
    context.fillRect(28, 26, 424, 248);
    context.fillStyle = '#365645';
    context.font = 'bold 28px sans-serif';
    context.fillText('ACORNARY / SAMPLE', 50, 78);
    context.font = '20px sans-serif';
    context.fillText('Oat drink - Original 1 L', 50, 126);
    context.font = '16px sans-serif';
    context.fillText('Best before: 2026-11-10', 50, 166);
    context.fillText('Review attachment only', 50, 206);
    const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (character) =>
      character.charCodeAt(0),
    );
    return new File([bytes], '包装标签样例.png', { type: 'image/png' });
  }
  const stream =
    'BT /F1 18 Tf 48 760 Td (Acornary trial - sample guide) Tj 0 -36 Td /F1 12 Tf (This document is a local sample. No upload or external request.) Tj 0 -24 Td (Use, save, preview and remove it within the trial household.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(content.length);
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = content.length;
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new File([content], '使用说明样例.pdf', { type: 'application/pdf' });
}
export const freshMutation = (baseRevision?: number): MutationState => ({
  baseRevision,
  open: false,
  state: 'draft',
  error: '',
  receipt: '',
  request: null,
});
export function createState(
  facts: DailyItemFacts | undefined,
  scenario: string,
  scope: 'item' | 'product',
): ReviewState {
  const item = facts?.item;
  const savedAttachments = [
    ...(getExtraReviewAttachments(item?.id || '') || []),
    ...(getExtraReviewAttachments(item?.skuId || '') || []),
  ];
  const dates =
    scenario === 'empty'
      ? []
      : facts?.dates
        ? structuredClone(facts.dates)
        : facts?.date
          ? [structuredClone(facts.date)]
          : [];
  if (scenario !== 'empty' && !facts?.dates && !isTrial())
    dates.push({
      kind: 'SERVICE_DUE',
      dateKind: null,
      dueOn: '2026-11-16',
      basis: '已记录的每 30 天检查计划',
      state: 'UPCOMING',
      source: 'DEADLINE',
      label: '检查存放状态',
    });
  const ownNotes: NoteRecord[] =
    scenario === 'empty'
      ? []
      : (
          getExtraReviewNotes(item?.id || '') ||
          initialNotes.filter((note) => note.itemId === item?.id)
        ).map((note) => ({
          id: note.id,
          title: note.title,
          excerpt: note.excerpt,
          body: note.body,
          scope: 'item',
          revision: item?.revision || 1,
        }));
  if (scenario !== 'empty') {
    const productNotes = getExtraReviewNotes(item?.skuId || '');
    if (productNotes)
      ownNotes.push(
        ...productNotes.map((note) => ({
          id: note.id,
          title: note.title,
          excerpt: note.excerpt,
          body: note.body,
          scope: 'product' as const,
          revision: 2,
        })),
      );
    else
      ownNotes.push({
        id: 'review-product-note',
        title: '商品使用说明',
        excerpt: '公共说明供这款商品参考。',
        body: '使用前请阅读包装说明。\n个人使用体验请写在单件笔记里。',
        scope: 'product',
        revision: 2,
      });
  }
  if (scenario === 'redacted')
    ownNotes.unshift({
      id: 'review-hidden-note',
      title: '私密记录',
      excerpt: '',
      scope: 'item',
      revision: 2,
      redacted: true,
    });
  const opened = scenario === 'already-opened' || item?.status.label === '已开封';
  return {
    opening: {
      intent: opened ? 'correct' : 'now',
      localTime: opened
        ? item?.facts.find((fact) => fact.kind === 'opening')?.value?.includes('T')
          ? item.facts.find((fact) => fact.kind === 'opening')!.value.slice(0, 16)
          : ''
        : '',
      timezone: 'Asia/Shanghai',
    },
    openingState: opened ? '已开封' : item?.status.label === '未开封' ? '未开封' : '开封状态未记录',
    openedAt: opened
      ? item?.facts.find((fact) => fact.kind === 'opening')?.value === '未记录'
        ? null
        : item?.facts.find((fact) => fact.kind === 'opening')?.value || null
      : null,
    facts: dates,
    dateDraft: structuredClone(dates[0] || blankDate),
    dateIndex: dates.length ? 0 : -1,
    month: '2026-11',
    completing: false,
    completedOn: '',
    notes: ownNotes,
    noteDrafts: {},
    selectedNotes: { item: 'new-item', product: 'new-product' },
    scope,
    productId: item?.skuId || null,
    noteMode: 'edit',
    mutations: {
      opening: freshMutation(item?.revision),
      dates: freshMutation(item?.revision),
      notes: freshMutation(item?.revision),
    },
    attachments: savedAttachments,
    attachmentNames: Object.fromEntries(savedAttachments.map((record) => [record.id, record.name])),
    attachmentLocalIds: Object.fromEntries(
      savedAttachments.map((record) => [record.id, record.localId]),
    ),
    pending: [],
    transfers: [],
    attachmentMessage: '',
    scanText: '',
    scanResult: { kind: 'idle' },
    scanSelected: null,
    cameraMessage: '',
    selectedLabels: item ? [item.id] : [],
    pages: item ? [{ pageId: uniqueId('print'), itemId: item.id, status: 'not-sent' }] : [],
    queue: [],
    paper: '30x12',
    connection: 'disconnected',
    printFailure: scenario === 'unknown' || scenario === 'print-unknown',
  };
}
export function saveDailyView(key: string, state: ReviewState) {
  const view = { ...state } as Partial<ReviewState>;
  for (const keys of Object.values(editKeys)) for (const field of keys) delete view[field];
  delete view.mutations;
  reviewStorage.setItem(`${key}:view`, JSON.stringify(view));
}
export function loadState(key: string, initial: ReviewState): ReviewState {
  try {
    const view = reviewStorage.getItem(`${key}:view`);
    const raw = view || reviewStorage.getItem(key);
    if (!raw) return initial;
    if (view) {
      const parsed = JSON.parse(view);
      if (!Array.isArray(parsed.pages) || !Array.isArray(parsed.pending))
        throw Error('视图存储格式无效。');
      return {
        ...initial,
        ...parsed,
        mutations: initial.mutations,
        connection: 'disconnected',
        queue: [],
        pages: parsed.pages.map((page: PrintPagePresentation) =>
          page.status === 'sending' ? { ...page, status: 'unknown' } : page,
        ),
      };
    }
    const parsed = JSON.parse(raw) as ReviewState;
    if (
      !parsed.mutations ||
      !Array.isArray(parsed.notes) ||
      !Array.isArray(parsed.pages) ||
      !parsed.noteDrafts
    )
      return initial;
    // A page that was sending when its adapter closed has an uncertain physical outcome.
    return {
      ...parsed,
      attachments: initial.attachments,
      attachmentNames: initial.attachmentNames,
      attachmentLocalIds: initial.attachmentLocalIds,
      mutations: Object.fromEntries(
        Object.entries(parsed.mutations).map(([kind, mutation]) => [
          kind,
          mutation.state === 'submitting' || mutation.state === 'validating'
            ? { ...mutation, state: 'networkUnknown' }
            : mutation,
        ]),
      ) as ReviewState['mutations'],
      notes: [
        ...initial.notes,
        ...parsed.notes.filter(
          (note) => !initial.notes.some((canonical) => canonical.id === note.id),
        ),
      ],
      connection: 'disconnected',
      queue: [],
      pages: parsed.pages.map((page) =>
        page.status === 'sending'
          ? { ...page, status: 'unknown', detail: '上次离开时仍在发送，请先核对纸张。' }
          : page,
      ),
    };
  } catch {
    return initial;
  }
}

function recordNoteHistory(
  request: RequestSnapshot,
  result: ReviewState,
  target: string,
  skuId: string,
  itemLabel: string,
  currentInstant: string,
) {
  // New single-item notes already have the shared note-count event.
  if (request.scope !== 'product' && request.noteId?.startsWith('new-')) return;
  const id = result.selectedNotes[request.scope!];
  appendReviewEvent(
    {
      ...baseHistory[0],
      operationLabel: request.noteId?.startsWith('new-') ? '新建商品公共说明' : '编辑笔记',
      objectLabel: itemLabel,
      event: {
        ...baseHistory[0].event!,
        id: `event_${request.key.replace(/^review-request_/, '')}`,
        operation_id: `operation_${request.key.replace(/^review-request_/, '')}`,
        target_kind: request.scope === 'product' ? 'CATALOG_NODE' : 'ITEM',
        target_id: request.scope === 'product' ? skuId : target,
        event_type: request.noteId?.startsWith('new-') ? 'NOTE_CREATE' : 'NOTE_UPDATE',
        before_revision: request.revision,
        after_revision: request.revision + 1,
        occurred_at: currentInstant,
        recorded_at: currentInstant,
        reason: '隔离试用笔记操作；正文保留在笔记中，历史仅记录引用。',
        changes: [
          {
            path: 'notes',
            before_present: !request.noteId?.startsWith('new-'),
            after_present: true,
            before: request.noteId?.startsWith('new-') ? undefined : { note_id: request.noteId },
            after: { note_id: id, scope: request.scope },
          },
        ],
      },
    },
    `${request.key}:history`,
  );
}

export interface DailyFixtureAttempt {
  request: RequestSnapshot;
  snapshot: ReviewState;
  /** Null only for an unchanged legacy RC1 fixture request, never a production command. */
  command: CommandAttempt | null;
  instant: string | null;
  timezone?: string | null;
}
export type DailyFixtureRecord = OperationRecord<ReviewState, DailyFixtureAttempt, ReviewState> & {
  predecessor?: { key: string; kind: EditSurface; request: RequestSnapshot | null };
};
export type DailyFixtureTask = DailyTaskController<ReviewState, DailyFixtureAttempt, ReviewState>;
const editKeys: Record<EditSurface, (keyof ReviewState)[]> = {
  opening: ['opening', 'openingState', 'openedAt'],
  dates: ['facts', 'dateDraft', 'dateIndex', 'completing', 'completedOn'],
  notes: ['notes', 'noteDrafts', 'selectedNotes', 'scope', 'productId'],
};
/** Task snapshots contain edit facts only; unrelated print/attachment state stays in the view journal. */
export function normalizeDailyDraft(state: ReviewState): ReviewState {
  return {
    ...structuredClone(state),
    productId: state.productId ?? null,
    mutations: { opening: freshMutation(), dates: freshMutation(), notes: freshMutation() },
    attachments: [],
    attachmentNames: {},
    attachmentLocalIds: {},
    pending: [],
    transfers: [],
    pages: [],
    queue: [],
    selectedLabels: [],
    scanResult: { kind: 'idle' },
  };
}
export function projectDailyState(
  view: ReviewState,
  records: Record<EditSurface, DailyFixtureRecord>,
): ReviewState {
  const next = { ...view, mutations: { ...view.mutations } };
  for (const kind of ['opening', 'dates', 'notes'] as const) {
    const record = records[kind];
    const draft = record.state === 'success' && record.result ? record.result : record.draft;
    for (const key of editKeys[kind])
      (next as unknown as Record<string, unknown>)[key] = draft[key];
    next.mutations[kind] = {
      ...view.mutations[kind],
      state: record.state,
      request: record.attempt?.request || null,
      error: record.error,
      receipt: record.result?.mutations[kind].receipt || '',
      baseRevision: record.revisions[record.targetIds[0]],
    };
  }
  return next;
}
export function dailyFixtureDraftChanged(
  kind: EditSurface,
  before: ReviewState,
  after: ReviewState,
) {
  return editKeys[kind].some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
function assertScope(scope: ApplicationScope) {
  if (!sameGeneration(scope, getFixtureScope()))
    throw Object.assign(Error('SESSION_CHANGED'), { code: 'SESSION_CHANGED' });
  assertTrialWrite();
}
function failure(message: string, code: string) {
  return Object.assign(Error(message), { code });
}
function currentRevision(kind: EditSurface, target: string, request?: RequestSnapshot) {
  if (kind === 'notes' && request?.scope === 'product') {
    const id = requestTarget(kind, target, request);
    const catalog = getManagementCatalogs().find(
      (entry) => entry.id === id && entry.kind === 'SKU',
    );
    if (!catalog) throw Error('尚未取得商品当前版本；商品笔记输入已保留。');
    return catalog.revision;
  }
  const item = getReviewWorld().items.find((entry) => entry.item.id === target)?.item;
  if (!item) throw failure('此件已不可读取。', 'NOT_FOUND');
  return item.revision;
}
export function dailyFixtureRequest(
  kind: EditSurface,
  target: string,
  state: ReviewState,
  revisions: Record<string, number>,
  key = uniqueId('review-request'),
): RequestSnapshot {
  const item = getReviewWorld().items.find((entry) => entry.item.id === target)?.item;
  const itemLabel = item?.name || '未取得物品';
  const targetId = kind === 'notes' && state.scope === 'product' ? state.productId || '' : target;
  const base = {
    key,
    target: {
      kind: (kind === 'notes' && state.scope === 'product' ? 'CATALOG_NODE' : 'ITEM') as
        'ITEM' | 'CATALOG_NODE',
      id: targetId,
    },
    accountId: getTrialScope().accountId,
    householdId: getTrialScope().householdId,
    revision: revisions[targetId],
    targetRevision: revisions[targetId],
  };
  if (kind === 'opening')
    return {
      ...base,
      opening: structuredClone(state.opening),
      summary: [
        `作用对象：${itemLabel} · ${target}`,
        `原记录：${state.openingState} · ${state.openedAt || '时间未记录'}`,
        `将记录：已开封 · ${state.opening.intent === 'unknown' ? '开封时间未记录' : state.opening.intent === 'now' ? '提交时的示例当前时间' : state.opening.localTime || '明确清除开封时间'}`,
      ],
    };
  if (kind === 'dates')
    return {
      ...base,
      date: structuredClone(state.dateDraft),
      dateIndex: state.dateIndex,
      completing: state.completing,
      completedOn: state.completedOn,
      summary: [
        `作用对象：${itemLabel} · ${target}`,
        `原日期：${state.facts[state.dateIndex] ? dateSummary(state.facts[state.dateIndex]) : '未记录'}`,
        state.completing
          ? `本次完成日：${state.completedOn || '未填写'}`
          : `新日期：${dateSummary(state.dateDraft)}`,
      ],
    };
  const noteId = state.selectedNotes[state.scope];
  const selected = state.notes.find((note) => note.id === noteId);
  const note = state.noteDrafts[`${state.scope}:${noteId}`] || {
    title: selected?.title || null,
    body: selected?.redacted ? undefined : selected?.body || '',
  };
  return {
    ...base,
    scope: state.scope,
    noteId,
    note: structuredClone(note),
    summary: [
      `作用对象：${state.scope === 'item' ? '仅此件' : '商品共有'} · ${targetId}`,
      `笔记：${note.title || '无标题'} · 目标版本 ${base.targetRevision}`,
      note.body || '正文未填写',
    ],
  };
}
interface SavedReceipt {
  kind: EditSurface;
  result: ReviewState;
  patches: DailyItemFacts[];
  phase: 'prepared' | 'committed';
  request?: RequestSnapshot;
}
export async function executeDailyFixture(
  scope: ApplicationScope,
  kind: EditSurface,
  target: string,
  attempt: DailyFixtureAttempt,
  loseReceipt = false,
): Promise<ReviewState> {
  assertScope(scope);
  const request = attempt.request;
  if (
    (request.accountId && request.accountId !== scope.accountId) ||
    (request.householdId && request.householdId !== scope.householdId)
  )
    throw failure('原请求所属家庭已变化。', 'SESSION_CHANGED');
  if (
    attempt.command &&
    JSON.stringify(commandFor(kind, target, request, attempt.snapshot, attempt.instant!)) !==
      JSON.stringify(attempt.command)
  )
    throw failure('原命令与冻结输入不一致。', 'IDEMPOTENCY_CONFLICT');
  const receiptKey = `acornary-review-extra-receipt:${request.key}`;
  const raw = reviewStorage.getItem(receiptKey);
  let saved: SavedReceipt | null = raw ? JSON.parse(raw) : null;
  if (
    saved &&
    (saved.kind !== kind ||
      JSON.stringify(saved.request || saved.result?.mutations[kind]?.request) !==
        JSON.stringify(request))
  )
    throw failure('同一键的原请求参数不一致。', 'IDEMPOTENCY_CONFLICT');
  if (saved?.phase === 'committed' && getReviewWorld().receipts[request.key]) {
    await flushReviewStorage();
    assertScope(scope);
    return saved.result;
  }
  const facts = getReviewWorld().items.find((entry) => entry.item.id === target);
  if (!facts) throw failure('此件已不可读取。', 'NOT_FOUND');
  if (!saved) {
    if (!attempt.instant && kind === 'opening' && request.opening?.intent === 'now')
      throw failure('旧请求未保存原开封时间，无法安全重建；原记录已保留。', 'IDEMPOTENCY_CONFLICT');
    if (currentRevision(kind, target, request) !== request.targetRevision)
      throw failure('物品版本已变化，请重新读取后核对。', 'REVISION_CONFLICT');
    const state = attempt.snapshot;
    const currentInstant = attempt.instant || trialInstant(),
      today = currentInstant.slice(0, 10);
    const context = { timezone: attempt.timezone ?? null };
    const next = structuredClone(state);
    let receipt = '';
    if (kind === 'opening') {
      const opening = request.opening!;
      next.openingState = '已开封';
      const offset =
        opening.timezone === 'UTC'
          ? '+00:00'
          : opening.timezone === 'Asia/Tokyo'
            ? '+09:00'
            : '+08:00';
      next.openedAt =
        opening.intent === 'unknown'
          ? null
          : opening.intent === 'now'
            ? currentInstant
            : opening.localTime
              ? `${opening.localTime}:00${offset}`
              : null;
      next.opening = {
        ...opening,
        intent: 'correct',
        localTime: next.openedAt?.slice(0, 16) || '',
      };
      receipt = `此件已记录为已开封；${next.openedAt ? `开封时间 ${next.openedAt}` : '开封时间仍未记录，不生成开封后期限'}。`;
    } else if (kind === 'dates') {
      const updated: DateFactPresentation = {
        ...request.date!,
        state:
          !context.timezone ||
          !request.date?.dueOn ||
          (request.date.kind === 'EXPIRY' && !request.date.dateKind)
            ? 'UNKNOWN'
            : request.date.dueOn < today
              ? 'OVERDUE'
              : request.date.dueOn === today
                ? 'DUE'
                : 'UPCOMING',
      };
      if (request.completing) {
        const completed: DateFactPresentation = {
          ...updated,
          state: 'COMPLETED',
          completedOn: request.completedOn,
        };
        if (request.dateIndex! >= 0) next.facts[request.dateIndex!] = completed;
        else next.facts.push(completed);
        const recurring =
          updated.kind === 'SERVICE_DUE' && updated.basis === '已记录的每 30 天检查计划';
        if (recurring) {
          const nextDay = new Date(`${request.completedOn}T00:00:00Z`);
          nextDay.setUTCDate(nextDay.getUTCDate() + 30);
          next.facts.push({
            ...updated,
            dueOn: nextDay.toISOString().slice(0, 10),
            state: 'UPCOMING',
            completedOn: null,
          });
          receipt = `已记录本次完成日 ${request.completedOn}；示例回执的下一日期为 ${nextDay.toISOString().slice(0, 10)}，依据既有每 30 天计划。`;
        } else receipt = `已完成 ${request.completedOn}；本次记录保留在日期历史中。`;
        next.dateDraft = completed;
        next.completing = false;
      } else {
        if (request.dateIndex! >= 0) next.facts[request.dateIndex!] = updated;
        else {
          next.facts.push(updated);
          next.dateIndex = next.facts.length - 1;
        }
        next.dateDraft = updated;
        receipt = `已保存：${dateSummary(updated)}。按当前家庭时区与试用日期重新读取；未知日期或类型保持未知。`;
      }
    } else {
      const note = request.note!;
      const existing = next.notes.findIndex((value) => value.id === request.noteId);
      const id =
        existing >= 0 ? request.noteId! : `note_${request.key.replace(/^review-request_/, '')}`;
      const record: NoteRecord = {
        id,
        scope: request.scope!,
        title: note.title,
        body: note.body,
        excerpt: note.body!.slice(0, 70),
        revision: request.revision + 1,
      };
      if (existing >= 0) next.notes[existing] = record;
      else next.notes.push(record);
      next.selectedNotes[request.scope!] = id;
      next.noteDrafts[`${request.scope}:${id}`] = note;
      if (request.noteId?.startsWith('new-'))
        delete next.noteDrafts[`${request.scope}:${request.noteId}`];
      receipt = `${request.scope === 'item' ? '此件笔记' : '商品公共说明'}已保存，版本 ${record.revision}；正文未转换成结构化资料。`;
    }
    next.mutations[kind] = {
      ...next.mutations[kind],
      state: 'success',
      receipt,
      error: '',
      request,
    };
    const updatedFacts = facts ? structuredClone(facts) : null;
    const patches: DailyItemFacts[] = [];
    if (updatedFacts && (kind !== 'notes' || request.scope === 'item')) {
      updatedFacts.item.revision += 1;
      if (kind === 'opening') {
        updatedFacts.item.status = { label: '已开封', tone: 'neutral' };
        updatedFacts.item.facts = [
          ...updatedFacts.item.facts.filter((fact) => fact.kind !== 'opening'),
          { kind: 'opening', label: '开封时间', value: next.openedAt || '未记录', priority: 3 },
        ];
      }
      if (kind === 'dates') {
        updatedFacts.dates = structuredClone(next.facts);
        updatedFacts.date = next.facts.find((fact) => fact.kind === 'EXPIRY');
        updatedFacts.item.facts = [
          ...updatedFacts.item.facts.filter((fact) => fact.kind !== 'deadline'),
          ...next.facts
            .filter((fact) => fact.kind !== 'EXPIRY')
            .map((fact) => ({
              kind: 'deadline' as const,
              label: fact.label || dateLabels[fact.kind],
              value: `${dateSummary(fact)}${fact.state === 'COMPLETED' ? ` · 已完成 ${fact.completedOn}` : ''}`,
              priority: 4,
            })),
        ];
      }
      if (kind === 'notes')
        updatedFacts.item.noteCount = next.notes.filter((note) => note.scope === 'item').length;
      patches.push(updatedFacts);
    }

    saved = { kind, result: next, patches, phase: 'prepared', request };
    reviewStorage.setItem(receiptKey, JSON.stringify(saved));
    await flushReviewStorage();
    assertScope(scope);
  }
  if (!Array.isArray(saved.patches) || saved.patches.some((patch) => patch.item.id !== target))
    throw failure('回执对象与原任务不一致。', 'IDEMPOTENCY_CONFLICT');
  const receipt = saved;
  runReviewTransaction(() => {
    assertScope(scope);
    if (!getReviewWorld().receipts[request.key]) {
      if (currentRevision(kind, target, request) !== request.targetRevision)
        throw failure('物品版本已变化，请重新读取后核对。', 'REVISION_CONFLICT');
      if (kind === 'notes' && request.scope === 'product' && attempt.command)
        updateManagementCatalogRevision(
          requestTarget(kind, target, request),
          request.targetRevision,
          request.targetRevision + 1,
        );
      updateReviewItems(receipt.patches, {
        requestKey: request.key,
        operationLabel:
          kind === 'notes' ? '保存笔记' : kind === 'dates' ? '保存日期事实' : '记录开封',
      });
    }
    if (kind === 'notes') {
      publishNotes(
        requestTarget(kind, target, request),
        receipt.result.notes,
        request.scope!,
        receipt.result.selectedNotes[request.scope!],
      );
      recordNoteHistory(
        request,
        receipt.result,
        target,
        requestTarget(kind, target, request),
        facts.item.name,
        attempt.instant || trialInstant(),
      );
    }
    reviewStorage.setItem(receiptKey, JSON.stringify({ ...receipt, phase: 'committed' }));
  });
  await flushReviewStorage();
  assertScope(scope);
  if (loseReceipt) throw failure('示例回执丢失，请恢复原请求。', 'NETWORK');
  return receipt.result;
}

const states = [
  'draft',
  'validationError',
  'approvalRequired',
  'submitting',
  'success',
  'networkUnknown',
  'revisionConflict',
  'offline',
  'forbidden',
  'sessionChanged',
];
export function fixtureDailyRevisions(
  target: string,
  productId?: string | null,
): Record<string, number> {
  const item = getReviewWorld().items.find((entry) => entry.item.id === target)?.item;
  if (!item) return {};
  const catalog = getManagementCatalogs().find(
    (entry) =>
      entry.id === (productId === undefined ? item.skuId : productId) && entry.kind === 'SKU',
  );
  return { [target]: item.revision, ...(catalog ? { [catalog.id]: catalog.revision } : {}) };
}
export function createDailyFixtureTask(
  kind: EditSurface,
  target: string,
  storageKey: string,
  draft: ReviewState,
  scenario: string,
): DailyFixtureTask {
  const scope = getFixtureScope();
  const taskId = `${storageKey}:task:${kind}`;
  const revisions = fixtureDailyRevisions(target, draft.productId);
  if (scenario === 'conflict' && revisions[target] > 1) revisions[target]--;
  const initial: DailyFixtureRecord = {
    version: 1,
    scope,
    taskId,
    targetIds: [target],
    original: normalizeDailyDraft(draft),
    draft: normalizeDailyDraft(draft),
    revisions,
    attempt: null,
    result: null,
    state: 'draft',
    reviewing: false,
    approval: null,
    error: '',
  };
  const valid = (value: unknown): value is DailyFixtureRecord =>
    validDailyFixtureRecord(value, taskId, target);
  return new DailyTaskController(initial, {
    currentScope: getFixtureScope,
    validateSaved: valid,
    storage: {
      load(loadScope, key) {
        if (!sameGeneration(loadScope, getFixtureScope())) throw Error('SESSION_CHANGED');
        const raw = reviewStorage.getItem(key);
        if (raw) return JSON.parse(raw);
        const legacyRaw = reviewStorage.getItem(storageKey);
        if (!legacyRaw) return null;
        const legacy = JSON.parse(legacyRaw) as ReviewState;
        if (!validState(legacy)) throw Error('旧试用任务结构无法安全恢复，原记录已保留。');
        const mutation = legacy.mutations[kind];
        if (!mutation || !states.includes(mutation.state)) throw Error('旧试用状态无法安全恢复。');
        const request = mutation.request;
        if (
          (['submitting', 'networkUnknown', 'success'].includes(mutation.state) && !request) ||
          (request && (!request.key || !Number.isInteger(request.targetRevision)))
        )
          throw Error('旧试用任务缺少原请求键或版本，未创建新请求。');
        return {
          ...initial,
          original: normalizeDailyDraft(legacy),
          draft: normalizeDailyDraft(legacy),
          predecessor: { key: storageKey, kind, request },
          state: mutation.state,
          revisions: request
            ? { ...revisions, [request.target?.id || target]: request.targetRevision }
            : revisions,
          attempt: request
            ? { request, snapshot: normalizeDailyDraft(legacy), command: null, instant: null }
            : null,
          attemptStatus: request
            ? mutation.state === 'success'
              ? 'committed'
              : mutation.state === 'revisionConflict'
                ? 'rejected'
                : 'uncertain'
            : undefined,
          result:
            mutation.state === 'success'
              ? {
                  ...normalizeDailyDraft(legacy),
                  mutations: { ...normalizeDailyDraft(legacy).mutations, [kind]: mutation },
                }
              : null,
          reviewing: mutation.open,
          error: mutation.error || '',
        };
      },
      async save(saveScope, key, value) {
        assertScope(saveScope);
        reviewStorage.setItem(key, JSON.stringify(value));
        await flushReviewStorage();
        assertScope(saveScope);
      },
    },
    freeze(record) {
      if (['offline', 'missing-capability', 'forbidden', 'session-changed'].includes(scenario))
        throw Error('当前场景不可写，输入已保留。');
      const request = dailyFixtureRequest(kind, target, record.draft, record.revisions);
      const instant = trialInstant();
      if (kind === 'opening') {
        const item = getReviewWorld().items.find((entry) => entry.item.id === target)?.item;
        if (
          !item ||
          item.profile !== 'CONSUMABLE' ||
          item.recordState !== 'VALID' ||
          item.status.label === '已用完'
        )
          throw Error('此件当前不支持开封操作。');
      }
      if (
        kind === 'dates' &&
        request.completing &&
        (!request.completedOn || request.completedOn > trialToday())
      )
        throw Error('请填写不晚于今天的完成日期。');
      if (kind === 'notes' && request.scope === 'product') currentRevision(kind, target, request);
      return {
        request,
        snapshot: normalizeDailyDraft(record.draft),
        command: commandFor(kind, target, request, record.draft, instant),
        instant,
        timezone: scenario === 'timezone-unknown' ? null : 'Asia/Shanghai',
      };
    },
    execute: (executeScope, attempt) =>
      executeDailyFixture(
        executeScope,
        kind,
        target,
        attempt,
        scenario === 'unknown' || scenario === 'network-unknown',
      ),
    recover: (executeScope, attempt) => executeDailyFixture(executeScope, kind, target, attempt),
  });
}
