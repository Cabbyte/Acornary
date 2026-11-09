// Isolated P04/P05 review adapter. No business API, camera, Bluetooth or production storage calls.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import {
  DailyExtras,
  type DailyExtraSurface,
  type DailyExtraReadState,
  type ExtraMutation,
  type OpeningDraft,
  type ExtraNote,
} from '../../src/features/daily/pages/daily-extras';
import { Button } from '../../src/ui/components/ui/button';
import { RadioGroup } from '../../src/ui/components/ui/radio-group';
import { InlineNotice } from '../../src/ui/components/ui/inline-notice';
import type { NoteDraft } from '../../src/ui/patterns/note-editor';
import type { PendingAttachment } from '../../src/ui/patterns/attachment-field';
import type { ScanResult, ScanCandidate } from '../../src/ui/patterns/scan-input';
import type { PrintPagePresentation } from '../../src/ui/patterns/label-print-panel';
import type {
  ActionAvailability,
  AttachmentView,
  DateFactPresentation,
  NoteView,
  OperationState,
} from '../../src/ui/patterns/types';
import { isPlainDate } from '../../src/ui/components/ui/calendar';
import { itemLabelURL, expandItemId } from '../../src/lib/labels';
import type { DailyItemFacts } from '../../src/features/daily/pages/models';
import { notes as initialNotes, firstItemId } from './fixtures';
import { useReviewWorld, updateReviewItems } from './inventory-session';

const today = '2026-11-07';
const nowLabel = '2026-11-07 14:30（Asia/Shanghai，UTC+08:00）';
const currentInstant = '2026-11-07T14:30:00+08:00';
const available: ActionAvailability = { kind: 'available' };
const blankDate: DateFactPresentation = {
  kind: 'EXPIRY',
  dateKind: null,
  dueOn: null,
  basis: null,
  state: 'UNKNOWN',
  source: 'LIFECYCLE',
  label: '包装日期',
};
const dateKindLabels = { USE_BY: '限用日期', BEST_BEFORE: '最佳食用期', ESTIMATED: '估计日期' };
const dateLabels: Record<DateFactPresentation['kind'], string> = {
  EXPIRY: '包装日期',
  WARRANTY_END: '保修结束',
  SERVICE_DUE: '保养日期',
  RETURN_BY: '归还期限',
  RENEWAL: '续期日期',
  REORDER_BY: '补货日期',
};
const uniqueId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const dateSummary = (fact: DateFactPresentation) =>
  `${fact.kind === 'EXPIRY' ? (fact.dateKind ? dateKindLabels[fact.dateKind] : '类型未记录') : dateLabels[fact.kind]} · ${fact.dueOn || '日期未记录'} · ${fact.basis || '依据未记录'}`;
type EditSurface = 'opening' | 'dates' | 'notes';
interface NoteRecord extends ExtraNote {
  body?: string;
  revision: number;
}
interface Transfer {
  scope: 'item' | 'product';
  id: string;
  localId: string;
  name: string;
  size: number;
  mime: string;
  state: 'uploaded' | 'unknown';
}
interface RequestSnapshot {
  key: string;
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
interface MutationState {
  baseRevision?: number;
  open: boolean;
  state: OperationState;
  error: string;
  receipt: string;
  request: RequestSnapshot | null;
  resolved?: boolean;
  choice?: 'current' | 'input';
}
interface ReviewState {
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
  noteMode: 'edit' | 'preview';
  mutations: Record<EditSurface, MutationState>;
  attachments: AttachmentView[];
  attachmentNames: Record<string, string>;
  attachmentLocalIds: Record<string, string>;
  pending: PendingAttachment[];
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
const noteListeners = new Set<() => void>();
function readNoteStore() {
  if (!noteStore) {
    try {
      noteStore = JSON.parse(sessionStorage.getItem(noteStoreKey) || '{}');
    } catch {
      noteStore = {};
    }
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
      return () => {
        noteListeners.delete(listener);
      };
    },
    () => getExtraReviewNotes(targetId),
    () => undefined,
  );
}
function publishNotes(targetId: string, notes: NoteRecord[], scope: 'item' | 'product') {
  const ownNotes: NoteView[] = notes
    .filter((note) => note.scope === scope)
    .map((note) => ({
      id: note.id,
      itemId: targetId,
      title: note.title,
      excerpt: note.redacted ? '已隐藏' : note.excerpt,
      body: note.redacted ? undefined : note.body,
      updatedAt: currentInstant,
      sensitivity: 'NORMAL',
    }));
  const next = { ...readNoteStore(), [targetId]: ownNotes };
  sessionStorage.setItem(noteStoreKey, JSON.stringify(next));
  noteStore = next;
  noteListeners.forEach((listener) => listener());
}
const freshMutation = (baseRevision?: number): MutationState => ({
  baseRevision,
  open: false,
  state: 'draft',
  error: '',
  receipt: '',
  request: null,
});
function createState(
  facts: DailyItemFacts | undefined,
  scenario: string,
  scope: 'item' | 'product',
): ReviewState {
  const item = facts?.item;
  const dates = scenario === 'empty' ? [] : facts?.date ? [structuredClone(facts.date)] : [];
  if (scenario !== 'empty')
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
    noteMode: 'edit',
    mutations: {
      opening: freshMutation(item?.revision),
      dates: freshMutation(item?.revision),
      notes: freshMutation(item?.revision),
    },
    attachments: [],
    attachmentNames: {},
    attachmentLocalIds: {},
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
function loadState(key: string, initial: ReviewState): ReviewState {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return initial;
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
function QRPreview({ id, label, text }: { id: string; label: string; text: string }) {
  const qr = QRCode.create(itemLabelURL(id, 'https://example.test'), { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const path = Array.from(qr.modules.data)
    .flatMap((value, index) =>
      value ? [`M${(index % size) + 4} ${Math.floor(index / size) + 4}h1v1h-1z`] : [],
    )
    .join('');
  return (
    <div className="vn-extra-label-art">
      <svg viewBox={`0 0 ${size + 8} ${size + 8}`} role="img" aria-label={`隔离样例二维码：${id}`}>
        <rect width={size + 8} height={size + 8} fill="white" />
        <path d={path} fill="black" />
      </svg>
      <span>
        {label}
        <br />
        {text}
        <br />
        编号 {id.slice(-6)}
        <br />
        示例家庭 · 标签预览
      </span>
    </div>
  );
}
function ReviewSession({
  path,
  scenario,
  navigate,
  target,
}: {
  path: string;
  scenario: string;
  navigate: (path: string) => void;
  target: string;
}) {
  const world = useReviewWorld();
  const route = new URL(path, 'https://review.invalid');
  const surface = route.pathname.split('/')[2] as DailyExtraSurface;
  const facts = world.items.find((entry) => entry.item.id === target);
  const item = facts?.item;
  const storageKey = `acornary-review-daily-extras-v1:${target}:${scenario}`;
  const [state, setState] = useState(() => {
    const initial = createState(
      facts,
      scenario,
      route.searchParams.get('scope') === 'product' ? 'product' : 'item',
    );
    const ids = route.searchParams
      .get('ids')
      ?.split(',')
      .filter((id) => /^item_[0-9a-f-]{36}$/i.test(id));
    if (ids?.length) {
      initial.selectedLabels = [...new Set(ids)];
      initial.pages = initial.selectedLabels.map((itemId) => ({
        itemId,
        pageId: uniqueId('print'),
        status: 'not-sent',
      }));
    }
    const loaded = loadState(storageKey, initial);
    return ids?.length &&
      !loaded.pages.some((page) => page.status === 'unknown' || page.status === 'sending')
      ? { ...loaded, selectedLabels: initial.selectedLabels, pages: initial.pages, queue: [] }
      : loaded;
  });
  const [storageError, setStorageError] = useState('');
  const [readRecovered, setReadRecovered] = useState(false);
  const [inspectPage, setInspectPage] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const files = useRef(new Map<string, File>());
  const change = (update: (current: ReviewState) => ReviewState) => setState(update);
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
      setStorageError('');
    } catch {
      setStorageError('浏览器未允许保存本地草稿，发送操作已暂停。');
    }
  }, [state, storageKey]);
  useEffect(() => {
    const scope = route.searchParams.get('scope');
    if (scope === 'item' || scope === 'product')
      setState((current) => (current.scope === scope ? current : { ...current, scope }));
  }, [route.searchParams.get('scope')]);
  useEffect(() => {
    const sending = state.pages.find((page) => page.status === 'sending');
    if (!sending) return;
    if (surface !== 'labels') {
      change((current) => ({
        ...current,
        queue: [],
        pages: current.pages.map((page) =>
          page.pageId === sending.pageId
            ? { ...page, status: 'unknown', detail: '已离开打印页，当前张需核对；后续页停止。' }
            : page,
        ),
      }));
      return;
    }
    const timer = window.setTimeout(
      () =>
        change((current) => {
          if (current.printFailure)
            return {
              ...current,
              queue: [],
              pages: current.pages.map((page) =>
                page.pageId === sending.pageId
                  ? { ...page, status: 'unknown', detail: '模拟传输中断；当前张可能已出纸。' }
                  : page,
              ),
            };
          const [next, ...rest] = current.queue;
          return {
            ...current,
            queue: rest,
            pages: current.pages.map((page) =>
              page.pageId === sending.pageId
                ? {
                    ...page,
                    status: 'device-feedback',
                    detail: '模拟设备报告完成；仍需核对真实纸张。',
                  }
                : page.pageId === next
                  ? { ...page, status: 'sending' }
                  : page,
            ),
          };
        }),
      850,
    );
    return () => window.clearTimeout(timer);
  }, [state.pages, state.printFailure, surface]);
  const navigateSurface = (next: DailyExtraSurface, extra = '') =>
    navigate(`/daily/${next}?target=${encodeURIComponent(target)}${extra}`);
  const readState: DailyExtraReadState =
    !item && surface !== 'scan' && surface !== 'labels'
      ? 'not-found'
      : scenario === 'forbidden' || scenario === 'session-changed'
        ? 'forbidden'
        : !readRecovered && scenario === 'loading'
          ? 'loading'
          : !readRecovered && scenario === 'error'
            ? 'error'
            : 'ready';
  const availability: ActionAvailability = storageError
    ? { kind: 'blockedState', reason: storageError }
    : scenario === 'offline'
      ? { kind: 'offline', reason: '当前离线，草稿可保留；恢复连接后重新核对再保存。' }
      : scenario === 'missing-capability'
        ? { kind: 'missingContract', reason: '此对象已不具备此资料的写入能力，原输入已保留。' }
        : available;
  const context = {
    itemId: target,
    itemLabel: item ? `${item.name}${item.subtitle ? ` · ${item.subtitle}` : ''}` : '未取得物品',
    productLabel: item ? `${item.name}${item.subtitle ? ` · ${item.subtitle}` : ''}` : '未取得商品',
    locationLabel: item?.location.path.join(' › ') || '位置未记录',
    revision: item?.revision || 1,
    timezone: scenario === 'timezone-unknown' ? null : 'Asia/Shanghai',
    today,
  };
  const common = {
    context,
    readState,
    onRetry: () => setReadRecovered(true),
    onBack: () => navigate(item ? `/items/${item.id}` : '/items'),
    onNavigate: navigateSurface,
  };
  const selectedNoteId = state.selectedNotes[state.scope];
  const selectedNote = state.notes.find((note) => note.id === selectedNoteId);
  const noteDraftKey = `${state.scope}:${selectedNoteId}`;
  const draftNote = state.noteDrafts[noteDraftKey] || {
    title: selectedNote?.title || null,
    body: selectedNote?.redacted ? undefined : selectedNote?.body || '',
  };
  const setMutation = (kind: EditSurface, changes: Partial<MutationState>) =>
    change((current) => ({
      ...current,
      mutations: { ...current.mutations, [kind]: { ...current.mutations[kind], ...changes } },
    }));
  function buildRequest(kind: EditSurface): RequestSnapshot {
    const boundRevision = state.mutations[kind].baseRevision || context.revision;
    const base = {
      key: uniqueId('review-request'),
      targetRevision: boundRevision,
      revision: kind === 'notes' ? selectedNote?.revision || boundRevision : boundRevision,
    };
    if (kind === 'opening')
      return {
        ...base,
        opening: structuredClone(state.opening),
        summary: [
          `作用对象：${context.itemLabel} · ${target}`,
          `原记录：${state.openingState} · ${state.openedAt || '时间未记录'}`,
          `将记录：已开封 · ${state.opening.intent === 'unknown' ? '开封时间未记录' : state.opening.intent === 'now' ? nowLabel : state.opening.localTime ? `${state.opening.localTime} · ${state.opening.timezone}` : '明确清除开封时间'}`,
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
          `作用对象：${context.itemLabel} · ${target}`,
          `原日期：${state.facts[state.dateIndex] ? dateSummary(state.facts[state.dateIndex]) : '未记录'}`,
          state.completing
            ? `本次完成日：${state.completedOn || '未填写'}；保留历史，下一日期以回执为准。`
            : `新日期：${dateSummary(state.dateDraft)}`,
          `家庭时区：${context.timezone || '未设置，不计算日期状态'}`,
        ],
      };
    return {
      ...base,
      note: structuredClone(draftNote),
      noteId: selectedNoteId,
      scope: state.scope,
      summary: [
        `作用对象：${state.scope === 'item' ? '仅此件' : '商品共有'} · ${context.itemLabel}`,
        `笔记：${draftNote.title || '无标题'} · ${draftNote.body?.length || 0} 字`,
        `原笔记：${selectedNoteId.startsWith('new-') ? '新建' : selectedNoteId} · 原版本 ${base.revision}`,
        draftNote.body || '正文未填写',
      ],
    };
  }
  function validate(kind: EditSurface, request: RequestSnapshot) {
    if (availability.kind !== 'available') return availability.reason;
    if (kind === 'opening') {
      const opening = request.opening!;
      if (opening.intent === 'backdate' && !opening.localTime) return '请填写实际开封日期与时间。';
      const offset =
        opening.timezone === 'UTC'
          ? '+00:00'
          : opening.timezone === 'Asia/Tokyo'
            ? '+09:00'
            : '+08:00';
      if (
        opening.localTime &&
        (!isPlainDate(opening.localTime.slice(0, 10)) ||
          !Number.isFinite(Date.parse(`${opening.localTime}:00${offset}`)) ||
          Date.parse(`${opening.localTime}:00${offset}`) > Date.parse(currentInstant))
      )
        return '开封时间需是有效日期，按所选时区换算后不能晚于示例当前时间。';
      if ((opening.intent === 'backdate' || opening.intent === 'correct') && !opening.timezone)
        return '请明确所填时间的时区。';
    }
    if (kind === 'dates') {
      if (
        request.completing &&
        (!request.completedOn || !isPlainDate(request.completedOn) || request.completedOn > today)
      )
        return '请填写不晚于今天的有效完成日期。';
      if (request.date?.dueOn && !isPlainDate(request.date.dueOn)) return '请填写有效日期。';
      if (
        !request.completing &&
        request.date?.dateKind === 'ESTIMATED' &&
        request.date.dueOn &&
        !request.date.basis?.trim()
      )
        return '请补充估计依据，保留日期的估计性质。';
    }
    if (kind === 'notes' && !request.note?.body?.trim()) return '请填写笔记正文；标题可以留空。';
    return '';
  }
  function applyRequest(kind: EditSurface, request: RequestSnapshot) {
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
      const updated = { ...request.date!, state: 'UNKNOWN' as const };
      if (request.completing) {
        const completed: DateFactPresentation = {
          ...updated,
          state: 'COMPLETED',
          completedOn: request.completedOn,
        };
        if (request.dateIndex! >= 0) next.facts[request.dateIndex!] = completed;
        else next.facts.push(completed);
        const recurring = updated.kind === 'SERVICE_DUE';
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
        receipt = `已保存：${dateSummary(updated)}。日期状态待重新读取，不推算为已过期。`;
      }
    } else {
      const note = request.note!;
      const existing = next.notes.findIndex((value) => value.id === request.noteId);
      const id = existing >= 0 ? request.noteId! : uniqueId('note');
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
    try {
      const updatedFacts = facts ? structuredClone(facts) : null;
      if (updatedFacts && (kind !== 'notes' || request.scope === 'item')) {
        updatedFacts.item.revision += 1;
        if (kind === 'opening') {
          updatedFacts.item.status = { label: '已开封', tone: 'neutral' };
          updatedFacts.item.facts = [
            ...updatedFacts.item.facts.filter((fact) => fact.kind !== 'opening'),
            { kind: 'opening', label: '开封时间', value: next.openedAt || '未记录', priority: 3 },
          ];
        }
        if (kind === 'dates' && request.date?.kind === 'EXPIRY') updatedFacts.date = next.dateDraft;
        if (kind === 'notes' && request.scope === 'item')
          updatedFacts.item.noteCount = next.notes.filter((note) => note.scope === 'item').length;
        sessionStorage.setItem(storageKey, JSON.stringify(next));
        updateReviewItems([updatedFacts]);
      }
      if (kind === 'notes')
        publishNotes(
          request.scope === 'product' ? item!.skuId : target,
          next.notes,
          request.scope!,
        );
      setState(next);
    } catch {
      setStorageError('示例回执未能完整保存，请保留草稿后核对原请求。');
      setMutation(kind, { state: 'networkUnknown', request, error: '' });
    }
  }
  function submit(kind: EditSurface) {
    const existing = state.mutations[kind];
    if (existing.state === 'networkUnknown' || existing.state === 'success') return;
    const request = existing.request || buildRequest(kind);
    const error = validate(kind, request);
    if (error) {
      setMutation(kind, { state: 'validationError', error, request: null });
      return;
    }
    if (
      (scenario === 'conflict' && !existing.resolved) ||
      ((kind !== 'notes' || request.scope === 'item') &&
        request.targetRevision !== context.revision)
    ) {
      setMutation(kind, { state: 'revisionConflict', request });
      return;
    }
    const frozen = {
      ...state,
      mutations: {
        ...state.mutations,
        [kind]: { ...existing, request, state: 'networkUnknown' as const },
      },
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(frozen));
    } catch {
      setStorageError('原请求无法保存在本地，请允许本地存储后再保存。');
      return;
    }
    if (scenario === 'unknown' || scenario === 'network-unknown')
      setMutation(kind, { state: 'networkUnknown', request, error: '' });
    else applyRequest(kind, request);
  }
  function mutation(kind: EditSurface): ExtraMutation {
    const current = state.mutations[kind];
    const request = current.request || buildRequest(kind);
    const currentText =
      kind === 'notes'
        ? '另一位家庭成员补充的正文：取用后请放回原处。'
        : kind === 'dates'
          ? '最佳食用期 · 2026-11-14 · 包装重新核对'
          : '已开封 · 2026-11-06T09:00:00+08:00';
    return {
      open: current.open,
      state: current.state,
      taskId: current.request?.key || `review-${kind}-${target}`,
      summary: request.summary,
      receipt: current.receipt,
      error: current.error,
      availability,
      onReview: () =>
        setMutation(kind, {
          open: true,
          ...(current.state === 'networkUnknown' || current.state === 'success'
            ? {}
            : { state: 'draft', error: '', request: null }),
        }),
      onClose: () => setMutation(kind, { open: false }),
      onSubmit: () => submit(kind),
      onRecover: () => {
        if (current.request) applyRequest(kind, current.request);
      },
      onEdit: () => setMutation(kind, { ...freshMutation(context.revision), resolved: true }),
      conflict:
        current.state === 'revisionConflict'
          ? {
              objectId: kind === 'notes' ? selectedNoteId : target,
              scopeLabel: kind === 'notes' && state.scope === 'product' ? '商品共有' : '仅此件',
              originalRevision: request.revision,
              currentRevision: request.revision + 1,
              fields: [
                {
                  key: 'value',
                  label:
                    kind === 'notes' ? '正文' : kind === 'dates' ? '日期、类型与依据' : '开封记录',
                  original: {
                    kind: 'known',
                    text: kind === 'notes' ? selectedNote?.body || '尚未创建' : request.summary[1],
                  },
                  current: { kind: 'known', text: currentText },
                  input: {
                    kind: 'known',
                    text: kind === 'notes' ? request.note?.body || '' : request.summary[2],
                  },
                },
              ],
              choices: { value: current.choice },
              availability,
              onChoose: (_, choice) => setMutation(kind, { choice }),
              onRefresh: () => setMutation(kind, { error: '已重新读取示例当前版本，请逐项决定。' }),
              onReconfirm: () => {
                if (!current.choice) return;
                change((value) => {
                  const next = structuredClone(value);
                  if (current.choice === 'current') {
                    if (kind === 'notes')
                      next.noteDrafts[noteDraftKey] = { title: draftNote.title, body: currentText };
                    if (kind === 'dates')
                      next.dateDraft = {
                        ...next.dateDraft,
                        dueOn: '2026-11-14',
                        dateKind: 'BEST_BEFORE',
                        basis: '包装重新核对',
                      };
                    if (kind === 'opening')
                      next.opening = {
                        intent: 'correct',
                        localTime: '2026-11-06T09:00',
                        timezone: 'Asia/Shanghai',
                      };
                  }
                  next.mutations[kind] = {
                    ...next.mutations[kind],
                    state: 'draft',
                    request: null,
                    error: '',
                    resolved: true,
                    baseRevision: context.revision,
                  };
                  return next;
                });
              },
            }
          : undefined,
    };
  }
  const notice = storageError ? (
    <InlineNotice tone="warning" title="草稿保存受限">
      {storageError}
    </InlineNotice>
  ) : null;
  if (surface === 'opening')
    return (
      <>
        {notice}
        <DailyExtras
          {...common}
          surface="opening"
          model={{
            draft: state.opening,
            onChange: (opening) => change((current) => ({ ...current, opening })),
            currentState: state.openingState,
            openedAt: state.openedAt,
            nowLabel,
            afterOpeningDays: null,
            mutation: mutation('opening'),
          }}
        />
      </>
    );
  if (surface === 'dates')
    return (
      <>
        {notice}
        <DailyExtras
          {...common}
          surface="dates"
          model={{
            facts: state.facts,
            selected: state.dateIndex,
            draft: state.dateDraft,
            onSelect: (dateIndex) =>
              change((current) => ({
                ...current,
                dateIndex,
                dateDraft: structuredClone(current.facts[dateIndex]),
                completing: false,
                mutations: { ...current.mutations, dates: freshMutation(context.revision) },
              })),
            onChange: (dateDraft) => change((current) => ({ ...current, dateDraft })),
            onAdd: (kind) => {
              if (kind && kind !== 'EXPIRY')
                change((current) => ({
                  ...current,
                  dateIndex: -1,
                  dateDraft: { ...blankDate, kind, source: 'DEADLINE', label: dateLabels[kind] },
                  completing: false,
                  mutations: { ...current.mutations, dates: freshMutation(context.revision) },
                }));
            },
            month: state.month,
            onMonthChange: (month) => change((current) => ({ ...current, month })),
            completing: state.completing,
            onCompletingChange: (completing) => change((current) => ({ ...current, completing })),
            completedOn: state.completedOn,
            onCompletedOnChange: (completedOn) =>
              change((current) => ({ ...current, completedOn })),
            recurring: state.dateDraft.kind === 'SERVICE_DUE',
            mutation: mutation('dates'),
          }}
        />
      </>
    );
  if (surface === 'notes')
    return (
      <>
        {notice}
        <DailyExtras
          {...common}
          surface="notes"
          model={{
            scope: state.scope,
            onScopeChange: (scope) => {
              change((current) => ({
                ...current,
                scope,
                mutations: { ...current.mutations, notes: freshMutation(context.revision) },
              }));
              navigateSurface('notes', `&scope=${scope}`);
            },
            notes: state.notes,
            selectedId: selectedNoteId,
            draft: draftNote,
            onChange: (draft) =>
              change((current) => ({
                ...current,
                noteDrafts: { ...current.noteDrafts, [noteDraftKey]: draft },
              })),
            onSelect: (id) =>
              change((current) => ({
                ...current,
                selectedNotes: { ...current.selectedNotes, [current.scope]: id },
                noteMode: 'preview',
                mutations: { ...current.mutations, notes: freshMutation(context.revision) },
              })),
            onCreate: () =>
              change((current) => ({
                ...current,
                selectedNotes: {
                  ...current.selectedNotes,
                  [current.scope]: `new-${current.scope}`,
                },
                noteMode: 'edit',
                mutations: { ...current.mutations, notes: freshMutation(context.revision) },
              })),
            mode: state.noteMode,
            onModeChange: (noteMode) => change((current) => ({ ...current, noteMode })),
            dirty:
              draftNote.body !== (selectedNote?.body || '') ||
              draftNote.title !== (selectedNote?.title || null),
            redacted: !!selectedNote?.redacted,
            mutation: {
              ...mutation('notes'),
              availability: selectedNote?.redacted
                ? { kind: 'forbidden', reason: '正文已隐藏，无法披露或覆盖。' }
                : availability,
            },
            onAttachments: () => navigateSurface('attachments', `&scope=${state.scope}`),
            onRecordFacts: () => navigateSurface('dates'),
          }}
        />
      </>
    );
  if (surface === 'attachments') {
    const unsupported =
      (scenario === 'mcp' || scenario === 'unsupported-host') &&
      route.searchParams.get('host') !== 'web';
    const scopeKind = state.scope === 'product' ? 'CATALOG_NODE' : 'ITEM';
    const visibleAttachments = state.attachments.filter(
      (attachment) => attachment.targetKind === scopeKind,
    );
    const visiblePending = state.pending.filter(
      (pending) => !('scope' in pending) || pending.scope === state.scope,
    );
    const visibleTransfers = state.transfers.filter((transfer) => transfer.scope === state.scope);
    const cap: ActionAvailability = unsupported
      ? {
          kind: 'unsupportedHost',
          reason: 'MCP 与当前宿主不提供附件上传；已有摘要仍可阅读，请在网站继续。',
        }
      : availability;
    const fail = (message: string) =>
      change((current) => ({ ...current, attachmentMessage: message }));
    function associate(id: string, recover: boolean) {
      const transfer = state.transfers.find((value) => value.id === id);
      if (!transfer || cap.kind !== 'available') return;
      if (!recover && (scenario === 'unknown' || scenario === 'network-unknown')) {
        change((current) => ({
          ...current,
          transfers: current.transfers.map((value) =>
            value.id === id ? { ...value, state: 'unknown' } : value,
          ),
          attachmentMessage: '关联回执未取得；原上传引用已保留，不会重新上传。',
        }));
        return;
      }
      change((current) => {
        const attachmentId = `attachment_${id.replace('upload_', '')}`;
        const attachment: AttachmentView = {
          id: attachmentId,
          targetKind: transfer.scope === 'product' ? 'CATALOG_NODE' : 'ITEM',
          mimeType: transfer.mime,
          fileSize: transfer.size,
          width: null,
          height: null,
          caption: transfer.name,
          sortOrder: current.attachments.length,
          sensitivity: 'NORMAL',
          thumbnailUrl: null,
        };
        return {
          ...current,
          attachments: current.attachments.some((value) => value.id === attachmentId)
            ? current.attachments
            : [...current.attachments, attachment],
          attachmentNames: { ...current.attachmentNames, [attachmentId]: transfer.name },
          attachmentLocalIds: { ...current.attachmentLocalIds, [attachmentId]: transfer.localId },
          transfers: current.transfers.filter((value) => value.id !== id),
          attachmentMessage: `${transfer.name} 已保存附件${recover ? '，恢复的是原关联结果' : ''}。`,
        };
      });
    }
    return (
      <>
        {notice}
        <DailyExtras
          {...common}
          surface="attachments"
          model={{
            scopeLabel: `${state.scope === 'product' ? '商品共有附件' : '仅此件附件'} · ${context.itemLabel}`,
            quotaLabel: `当前目标 ${visibleAttachments.length} / 20；隔离示例占用 ${Math.ceil(state.attachments.reduce((total, attachment) => total + attachment.fileSize, 0) / 1024)} KiB。`,
            field: {
              capability: cap,
              allowLocalSelection: !unsupported,
              pending: visiblePending,
              error: undefined,
              onFilesSelected: (chosen) => {
                if (cap.kind !== 'available') return;
                const occupied =
                  visibleAttachments.length + visiblePending.length + visibleTransfers.length;
                if (occupied + chosen.length > 20) {
                  fail('每个目标最多 20 个有效附件，包含当前待处理文件；这次选择尚未加入。');
                  return;
                }
                const bytesIn = (value: ReviewState) =>
                  value.attachments.reduce((sum, attachment) => sum + attachment.fileSize, 0) +
                  value.pending.reduce((sum, pending) => sum + (pending.size || 0), 0) +
                  value.transfers.reduce((sum, transfer) => sum + transfer.size, 0);
                let used = bytesIn(state);
                try {
                  for (let index = 0; index < sessionStorage.length; index++) {
                    const key = sessionStorage.key(index);
                    if (
                      key &&
                      key !== storageKey &&
                      key.startsWith('acornary-review-daily-extras-v1:') &&
                      key.endsWith(`:${scenario}`)
                    )
                      used += bytesIn(JSON.parse(sessionStorage.getItem(key)!));
                  }
                } catch {
                  fail('当前无法核对家庭附件占用，请先恢复本地草稿存储。');
                  return;
                }
                if (
                  used + chosen.reduce((sum, file) => sum + file.size, 0) > 5 * 1024 ** 3 ||
                  scenario === 'quota-full'
                ) {
                  fail('示例家庭总容量已达到 5 GiB，尚未选择这些文件。');
                  return;
                }
                const rejected = chosen.filter(
                  (file) =>
                    !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(
                      file.type,
                    ) ||
                    file.size > 25 * 1024 ** 2 ||
                    file.size === 0,
                );
                if (rejected.length) {
                  fail(
                    `未加入：${rejected.map((file) => file.name).join('、')}。只允许 JPEG / PNG / WebP / PDF，且每个文件需大于 0、最多 25 MiB。`,
                  );
                  return;
                }
                const pending = chosen.map((file) => {
                  const id = uniqueId('local-file');
                  files.current.set(id, file);
                  return {
                    id,
                    name: file.name,
                    mimeType: file.type,
                    size: file.size,
                    state: 'selected' as const,
                    scope: state.scope,
                  };
                });
                change((current) => ({
                  ...current,
                  pending: [...current.pending, ...pending],
                  attachmentMessage: '文件只保留在当前浏览器内；尚未执行示例上传。',
                }));
              },
              onUploadIntent: unsupported
                ? undefined
                : (ids) =>
                    change((current) => {
                      const chosen = current.pending.filter((pending) => ids.includes(pending.id));
                      const absent = chosen.filter((pending) => !files.current.has(pending.id));
                      if (absent.length)
                        return {
                          ...current,
                          attachmentMessage:
                            '浏览器重新打开后无法恢复本机文件内容，请移除待选条目并重新选择；已存在的上传引用不会重建。',
                        };
                      const transfers: Transfer[] = chosen.map((pending) => ({
                        id: uniqueId('upload'),
                        localId: pending.id,
                        name: pending.name,
                        mime: pending.mimeType!,
                        size: pending.size!,
                        state: 'uploaded',
                        scope: state.scope,
                      }));
                      return {
                        ...current,
                        pending: current.pending.filter((pending) => !ids.includes(pending.id)),
                        transfers: [...current.transfers, ...transfers],
                        attachmentMessage: '示例上传完成，尚未关联；没有文件传输到服务器。',
                      };
                    }),
              onRemove: (id) => {
                files.current.delete(id);
                change((current) => ({
                  ...current,
                  pending: current.pending.filter((pending) => pending.id !== id),
                }));
              },
            },
            list: {
              attachments: visibleAttachments,
              presentations: Object.fromEntries(
                visibleAttachments.map((attachment) => [
                  attachment.id,
                  { name: state.attachmentNames[attachment.id], state: 'ready' as const },
                ]),
              ),
              removeAvailability: cap,
              onOpen: (attachment) => {
                const file = files.current.get(state.attachmentLocalIds[attachment.id]);
                if (!file) {
                  fail(
                    '已读取附件摘要；本机文件内容未保留，当前无法下载。可重新选择文件作为新的独立附件。',
                  );
                  return;
                }
                const url = URL.createObjectURL(file);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = state.attachmentNames[attachment.id] || file.name;
                anchor.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                fail(`${file.name} 已交给浏览器下载；PDF 不生成缩略图。`);
              },
              onRemove: (attachment) => setRemoveId(attachment.id),
            },
            transfers: visibleTransfers.map((transfer) => ({
              id: transfer.id,
              name: transfer.name,
              state: transfer.state,
              onAssociate: () => associate(transfer.id, false),
              onRecover: () => associate(transfer.id, true),
            })),
            message: state.attachmentMessage,
            ...(unsupported
              ? {
                  webPath: `/daily/attachments?target=${target}&scope=${state.scope}`,
                  onContinueWeb: () =>
                    navigateSurface('attachments', `&scope=${state.scope}&host=web`),
                }
              : {}),
            removeName: removeId ? state.attachmentNames[removeId] || '附件' : undefined,
            onConfirmRemove: () => {
              if (cap.kind !== 'available') return;
              change((current) => ({
                ...current,
                attachments: current.attachments.filter((attachment) => attachment.id !== removeId),
                attachmentMessage: '已移除此对象的附件关联。',
              }));
              setRemoveId(null);
            },
            onCancelRemove: () => setRemoveId(null),
          }}
        />
      </>
    );
  }
  if (surface === 'scan') {
    const candidates = world.items
      .filter((entry) => entry.item.skuId === world.items[0]?.item.skuId)
      .map((entry): ScanCandidate => ({
        id: entry.item.id,
        name: `${entry.item.name} · ${entry.item.subtitle || '规格未记录'} · ${entry.item.id.slice(-6)}`,
        locationLabel: entry.item.location.path.join(' › ') || '位置未记录',
        ...(entry.item.status.label === '已用完'
          ? { unavailableReason: '此件已用完，请查看商品选择其他实物。' }
          : {}),
      }));
    function resolve(raw: string) {
      const value = raw.trim();
      let result: ScanResult;
      const candidateURL = (() => {
        try {
          return new URL(value, 'https://example.test');
        } catch {
          return null;
        }
      })();
      const compact = candidateURL?.pathname.match(/^\/i\/([A-Za-z0-9_-]{22})$/)?.[1];
      const trusted =
        candidateURL?.origin === 'https://example.test' ||
        candidateURL?.origin === window.location.origin;
      if (compact && trusted) {
        const id = expandItemId(compact);
        const entry = world.items.find((entry) => entry.item.id === id);
        result = entry
          ? {
              kind: 'ItemQR',
              sourceText: raw,
              item: {
                id: entry.item.id,
                name: `${entry.item.name} · ${entry.item.subtitle || ''}`,
                locationLabel: entry.item.location.path.join(' › ') || '位置未记录',
              },
            }
          : {
              kind: 'forbidden',
              sourceText: raw,
              reason: '当前家庭无法访问此物品。请返回物品列表选择可访问的一件。',
            };
      } else if (value === '6901234567890' || value === '6900000000000') {
        result = {
          kind: 'barcode',
          sourceText: raw,
          barcode: value,
          candidates: value === '6900000000000' ? [] : candidates.slice(0, 2),
          hasMore: value !== '6900000000000' && candidates.length > 2,
        };
      } else if (value === 'ambiguous') {
        result = {
          kind: 'ambiguous',
          sourceText: raw,
          candidates: [],
          reason: '此编码对应两款不同规格，请先打开下方商品确认；没有自动指定某一件。',
        };
      } else
        result = {
          kind: 'unknown',
          sourceText: raw,
          reason: /^https?:/i.test(value)
            ? '这不是当前支持的物品链接；保留原文，不打开外部网址。'
            : '尚未识别，可保留文字搜索，或重新扫描。',
        };
      change((current) => ({
        ...current,
        scanText: raw,
        scanResult: result,
        scanSelected: null,
        cameraMessage: '',
      }));
    }
    const currentResult =
      'sourceText' in state.scanResult && state.scanResult.sourceText === state.scanText;
    const hasProducts =
      currentResult &&
      (state.scanResult.kind === 'barcode' || state.scanResult.kind === 'ambiguous');
    const products = hasProducts
      ? [...new Map(world.items.map((entry) => [entry.item.skuId, entry])).values()]
          .filter((_, index) => (state.scanResult.kind === 'ambiguous' ? index < 2 : index === 0))
          .map((entry) => ({
            id: entry.item.skuId,
            name: `${entry.item.name} · ${entry.item.subtitle || '规格未记录'}`,
            details: `${state.scanResult.kind === 'ambiguous' ? '编码存在多个商品候选，需人工核对。' : '条码识别只确定商品，不确定具体实物。'} 位置和余量各件不同。`,
          }))
      : [];
    return (
      <>
        {notice}
        <DailyExtras
          {...common}
          surface="scan"
          model={{
            input: {
              rawText: state.scanText,
              onRawTextChange: (scanText) =>
                change((current) => ({ ...current, scanText, scanSelected: null })),
              result: state.scanResult,
              onResolve: resolve,
              selectedItemId: state.scanSelected,
              onSelectItem: (scanSelected) => change((current) => ({ ...current, scanSelected })),
              onContinue: (id) => navigate(`/items/${id}`),
              cameraAvailability:
                scenario === 'unsupported-host' || scenario === 'mcp'
                  ? { kind: 'unsupportedHost', reason: '此宿主不提供相机，请粘贴完整编码。' }
                  : scenario === 'camera-denied'
                    ? { kind: 'forbidden', reason: '相机权限被拒绝，可以继续手动输入。' }
                    : available,
              onRequestCamera: () =>
                change((current) => ({
                  ...current,
                  cameraMessage:
                    '隔离预览不访问相机，未申请设备权限。请使用手动输入或下方识别样例。',
                })),
              onLoadMoreCandidates: () =>
                change((current) => ({
                  ...current,
                  scanResult:
                    current.scanResult.kind === 'barcode'
                      ? { ...current.scanResult, candidates, hasMore: false }
                      : current.scanResult,
                })),
            },
            products,
            onProduct: (id) => navigate(`/products/${id}`),
            onIntake: (id) => navigate(`/tasks/intake?target=${encodeURIComponent(id)}`),
            onSearch: () => navigate(`/search?q=${encodeURIComponent(state.scanText)}`),
            examples: [
              {
                label: '此件 QR',
                value: itemLabelURL(item?.id || firstItemId, 'https://example.test'),
              },
              { label: '商品条码', value: '6901234567890' },
              { label: '多商品歧义', value: 'ambiguous' },
              { label: '无可读实物', value: '6900000000000' },
              { label: '外部网址', value: 'https://unknown.example/path' },
              {
                label: '不可访问物品',
                value: itemLabelURL(
                  'item_00000000-0000-4000-8000-999999999999',
                  'https://example.test',
                ),
              },
            ],
            onExample: resolve,
            cameraMessage: state.cameraMessage,
          }}
        />
      </>
    );
  }
  const unsupported =
    (scenario === 'unsupported-host' || scenario === 'mcp' || scenario === 'mobile') &&
    route.searchParams.get('host') !== 'web';
  const selectedItems = state.selectedLabels.flatMap((id) => {
    const entry = world.items.find((value) => value.item.id === id);
    return entry ? [entry] : [];
  });
  const startPrinting = (ids: readonly string[]) => {
    if (
      state.pages.some((page) => page.status === 'unknown' || page.status === 'sending') ||
      unsupported ||
      state.connection !== 'connected'
    )
      return;
    const safeIds = ids.filter((id) =>
      state.pages.some((page) => page.pageId === id && page.status === 'not-sent'),
    );
    const [first, ...queue] = safeIds;
    if (!first) return;
    change((current) => ({
      ...current,
      queue,
      pages: current.pages.map((page) =>
        page.pageId === first ? { ...page, status: 'sending' } : page,
      ),
    }));
  };
  return (
    <>
      {notice}
      <DailyExtras
        {...common}
        surface="labels"
        model={{
          available: world.items
            .filter((entry) => entry.item.recordState === 'VALID')
            .slice(0, 12)
            .map((entry) => ({
              id: entry.item.id,
              name: `${entry.item.name} · ${entry.item.subtitle || ''} · ${entry.item.id.slice(-6)}`,
              location: entry.item.location.path.join(' › ') || '位置未记录',
            })),
          onToggle: (id) =>
            change((current) => {
              if (current.pages.some((page) => page.status !== 'not-sent')) return current;
              const selectedLabels = current.selectedLabels.includes(id)
                ? current.selectedLabels.filter((value) => value !== id)
                : [...current.selectedLabels, id];
              return {
                ...current,
                selectedLabels,
                pages: selectedLabels.map(
                  (itemId) =>
                    current.pages.find((page) => page.itemId === itemId) || {
                      pageId: uniqueId('print'),
                      itemId,
                      status: 'not-sent',
                    },
                ),
              };
            }),
          panel: {
            selectedItemIds: state.selectedLabels,
            items: selectedItems.map((entry) => ({
              id: entry.item.id,
              name: `${entry.item.name} · ${entry.item.subtitle || ''}`,
              labelText: `${entry.date ? dateSummary(entry.date) : '日期未记录'} · 标签 ${entry.item.id.slice(-6)} · ${state.paper.replace('x', ' × ')} mm`,
              preview: (
                <QRPreview
                  id={entry.item.id}
                  label={entry.item.name}
                  text={entry.date ? dateSummary(entry.date) : '日期未记录'}
                />
              ),
            })),
            pages: state.pages,
            deviceCapability: unsupported
              ? {
                  kind: 'unsupportedHost',
                  reason:
                    '当前手机 Web / MCP 不提供标签设备连接。请在安全上下文、支持 Web Bluetooth 的桌面浏览器继续并重新选设备。',
                }
              : availability,
            connection: state.connection,
            deviceLabel: '隔离模拟打印机 · 不连接真实设备',
            onConnect: () => change((current) => ({ ...current, connection: 'connected' })),
            onPrintUnsent: startPrinting,
            onStop: () => change((current) => ({ ...current, queue: [] })),
            onInspectPage: setInspectPage,
            onConfirmPaper: (id) =>
              change((current) => ({
                ...current,
                pages: current.pages.map((page) =>
                  page.pageId === id
                    ? {
                        ...page,
                        status: 'paper-confirmed',
                        detail: '审阅者在示例中确认纸张；不作为真实设备验收证据。',
                      }
                    : page,
                ),
              })),
          },
          paper: state.paper,
          onPaperChange: (paper) => change((current) => ({ ...current, paper })),
          inspectPageId: inspectPage,
          onCloseInspect: () => setInspectPage(null),
          onReprint: (id) => {
            change((current) => ({
              ...current,
              pages: current.pages.map((page) =>
                page.pageId === id
                  ? {
                      ...page,
                      status: 'not-sent',
                      detail: '用户已核对并明确选择重打；等待再次发送。',
                    }
                  : page,
              ),
            }));
            setInspectPage(null);
          },
          ...(unsupported
            ? {
                onContinueWeb: () =>
                  navigateSurface(
                    'labels',
                    `&host=web&ids=${encodeURIComponent(state.selectedLabels.join(','))}`,
                  ),
              }
            : {}),
          controls: (
            <section className="vn-extra-card">
              <RadioGroup
                label="隔离设备结果"
                value={state.printFailure ? 'unknown' : 'feedback'}
                disabled={state.pages.some((page) => page.status === 'sending')}
                onValueChange={(value) =>
                  change((current) => ({ ...current, printFailure: value === 'unknown' }))
                }
                options={[
                  { value: 'feedback', label: '设备报告完成' },
                  { value: 'unknown', label: '传输中断，结果未知' },
                ]}
              />
              {state.pages.some((page) => page.status !== 'not-sent') && (
                <>
                  <p className="vn-muted">
                    已有发送记录，当前选择已锁定；确认全部纸张后可开始新的标签任务。
                  </p>
                  <Button
                    variant="secondary"
                    disabled={state.pages.some(
                      (page) =>
                        page.status === 'sending' ||
                        page.status === 'unknown' ||
                        page.status === 'device-feedback',
                    )}
                    onClick={() =>
                      change((current) => ({
                        ...current,
                        pages: current.selectedLabels.map((itemId) => ({
                          itemId,
                          pageId: uniqueId('print'),
                          status: 'not-sent',
                        })),
                        queue: [],
                      }))
                    }
                  >
                    开始新标签任务
                  </Button>
                </>
              )}
            </section>
          ),
        }}
      />
    </>
  );
}
export function DailyExtrasJourney({
  path,
  scenario,
  navigate,
}: {
  path: string;
  scenario: string;
  navigate: (path: string) => void;
}) {
  const route = new URL(path, 'https://review.invalid');
  const target = route.searchParams.get('target') || route.searchParams.get('item') || firstItemId;
  return (
    <ReviewSession
      key={`${target}:${scenario}`}
      path={path}
      scenario={scenario}
      navigate={navigate}
      target={target}
    />
  );
}
