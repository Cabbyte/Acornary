import { trialToday, trialInstant } from '../trial/clock';
// Isolated P04/P05 review adapter. No business API, camera, Bluetooth or production storage calls.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import {
  DailyExtras,
  type DailyExtraSurface,
  type DailyExtraReadState,
  type ExtraMutation,
} from '../../src/features/daily/pages/daily-extras';
import { Button } from '../../src/ui/components/ui/button';
import { RadioGroup } from '../../src/ui/components/ui/radio-group';
import { InlineNotice } from '../../src/ui/components/ui/inline-notice';
import type { ScanResult, ScanCandidate } from '../../src/ui/patterns/scan-input';
import type { ActionAvailability, AttachmentView } from '../../src/ui/patterns/types';
import { itemLabelURL, expandItemId } from '../../src/lib/labels';
import { firstItemId, history as baseHistory } from './fixtures';
import {
  useReviewWorld,
  updateReviewItems,
  getReviewWorld,
  appendReviewEvent,
} from './inventory-session';
import { reviewStorage, flushReviewStorage, runReviewTransaction } from '../trial/storage';
import { getTrialScope, subscribeTrialScope, isTrial } from '../trial/session';

import {
  available,
  blankDate,
  dateLabels,
  uniqueId,
  dateSummary,
  samples,
  sampleFile,
  freshMutation,
  createState,
  loadState,
  saveDailyView,
  scopeKey,
  publishAttachments,
  readAttachmentStore,
  getExtraReviewAttachments,
  useExtraReviewAttachments,
  createDailyFixtureTask,
  projectDailyState,
  normalizeDailyDraft,
  dailyFixtureDraftChanged,
  dailyFixtureRequest,
  fixtureDailyRevisions,
  type EditSurface,
  type ReviewState,
  type RequestSnapshot,
  type MutationState,
  type Transfer,
  type StoredAttachment,
} from './daily-extras-fixture';
export {
  useExtraReviewNotes,
  getExtraReviewNotes,
  useExtraReviewAttachments,
  getExtraReviewAttachments,
} from './daily-extras-fixture';
import { useOperationSessions } from '../../src/app-vnext/operation-context';
import { getFixtureScope } from '../trial/application';
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
  const today = trialToday(),
    currentInstant = trialInstant(),
    nowLabel = `${today} 14:30（Asia/Shanghai，UTC+08:00）`;
  const world = useReviewWorld();
  const trialScope = useSyncExternalStore(subscribeTrialScope, getTrialScope, getTrialScope);
  const route = new URL(path, 'https://review.invalid');
  const surface = route.pathname.split('/')[2] as DailyExtraSurface;
  const facts = world.items.find((entry) => entry.item.id === target);
  const item = facts?.item;
  const storageKey = `acornary-review-daily-extras-v1:${target}:${isTrial() ? 'trial' : scenario}`;
  const [viewState, setState] = useState(() => {
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
  const registry = useOperationSessions();
  const scope = getFixtureScope();
  const openingTask = registry.get(scope, `${storageKey}:task:opening`, () =>
    createDailyFixtureTask('opening', target, storageKey, viewState, scenario),
  );
  const datesTask = registry.get(scope, `${storageKey}:task:dates`, () =>
    createDailyFixtureTask('dates', target, storageKey, viewState, scenario),
  );
  const notesTask = registry.get(scope, `${storageKey}:task:notes`, () =>
    createDailyFixtureTask('notes', target, storageKey, viewState, scenario),
  );
  const records = {
    opening: useSyncExternalStore(openingTask.subscribe, openingTask.getSnapshot),
    dates: useSyncExternalStore(datesTask.subscribe, datesTask.getSnapshot),
    notes: useSyncExternalStore(notesTask.subscribe, notesTask.getSnapshot),
  };
  const tasks = { opening: openingTask, dates: datesTask, notes: notesTask };
  const state = projectDailyState(viewState, records);
  const [storageError, setStorageError] = useState('');
  const [readRecovered, setReadRecovered] = useState(false);
  const [inspectPage, setInspectPage] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const savedItemAttachments = useExtraReviewAttachments(target);
  const savedProductAttachments = useExtraReviewAttachments(item?.skuId || '');
  const files = useRef(new Map<string, File>());
  const commitBusy = useRef(false);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  useEffect(() => {
    const records = [...(savedItemAttachments || []), ...(savedProductAttachments || [])];
    setState((current) =>
      JSON.stringify(current.attachments) === JSON.stringify(records)
        ? current
        : {
            ...current,
            attachments: records,
            attachmentNames: Object.fromEntries(records.map((record) => [record.id, record.name])),
            attachmentLocalIds: Object.fromEntries(
              records.map((record) => [record.id, record.localId]),
            ),
          },
    );
  }, [savedItemAttachments, savedProductAttachments]);
  const change = (update: (current: ReviewState) => ReviewState) => {
    const next = update(state);
    for (const kind of ['opening', 'dates', 'notes'] as const) {
      if (dailyFixtureDraftChanged(kind, state, next)) {
        void tasks[kind].updateInput(normalizeDailyDraft(next));
      }
    }
    setState(next);
  };
  useEffect(() => {
    try {
      saveDailyView(storageKey, viewState);
      setStorageError('');
    } catch {
      setStorageError('浏览器未允许保存本地草稿，发送操作已暂停。');
    }
  }, [viewState, storageKey]);
  useEffect(() => {
    const scope = route.searchParams.get('scope');
    if (scope === 'item' || scope === 'product')
      if (state.scope !== scope) change((current) => ({ ...current, scope }));
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
  const availability: ActionAvailability =
    trialScope.role === 'viewer'
      ? { kind: 'readOnly', reason: '当前示例身份只读，可查看资料但不能保存修改。' }
      : storageError
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
    return dailyFixtureRequest(
      kind,
      target,
      state,
      records[kind].revisions,
      `review-${kind}-${target}`,
    );
  }
  function mutation(kind: EditSurface): ExtraMutation {
    const current = state.mutations[kind];
    const request = current.request || buildRequest(kind);
    const currentFacts = createState(
      getReviewWorld().items.find((entry) => entry.item.id === target),
      scenario,
      state.scope,
    );
    currentFacts.selectedNotes = state.selectedNotes;
    const currentNote = currentFacts.notes.find((note) => note.id === selectedNoteId);
    currentFacts.noteDrafts = {
      [noteDraftKey]: { title: currentNote?.title || null, body: currentNote?.body || '' },
    };
    currentFacts.dateIndex = state.dateIndex;
    currentFacts.dateDraft = currentFacts.facts[state.dateIndex] || state.dateDraft;
    const currentText =
      kind === 'notes'
        ? currentNote?.body || '尚未创建'
        : kind === 'dates'
          ? dateSummary(currentFacts.dateDraft)
          : `${currentFacts.openingState} · ${currentFacts.openedAt || '时间未记录'}`;
    return {
      open: current.open,
      state: current.state,
      taskId: current.request?.key || `review-${kind}-${target}`,
      summary: request.summary,
      receipt: current.receipt,
      error: current.error,
      availability,
      onReview: async () => {
        const record = tasks[kind].getSnapshot();
        if (
          kind === 'notes' &&
          state.scope === 'product' &&
          state.productId &&
          !record.attempt &&
          !record.revisions[state.productId]
        ) {
          const read = fixtureDailyRevisions(target, state.productId);
          if (read[state.productId]) {
            await tasks[kind].refreshDraft(
              normalizeDailyDraft(state),
              { ...record.revisions, [state.productId]: read[state.productId] },
              normalizeDailyDraft(currentFacts),
            );
          }
        }
        setMutation(kind, { open: true });
      },
      onClose: async () => {
        if (await tasks[kind].retain()) setMutation(kind, { open: false });
      },
      onSubmit: () => {
        if (availability.kind === 'available') void tasks[kind].submitDraft();
      },
      onRecover: () => {
        if (availability.kind === 'available') void tasks[kind].recoverOriginal();
      },
      onEdit: () => {
        const refreshed = createState(
          getReviewWorld().items.find((entry) => entry.item.id === target),
          scenario,
          state.scope,
        );
        void tasks[kind]
          .restart(normalizeDailyDraft(refreshed), fixtureDailyRevisions(target))
          .catch((error) => setStorageError(String(error)));
      },
      conflict:
        current.state === 'revisionConflict'
          ? {
              objectId: kind === 'notes' ? selectedNoteId : target,
              scopeLabel: kind === 'notes' && state.scope === 'product' ? '商品共有' : '仅此件',
              originalRevision: request.revision,
              currentRevision:
                fixtureDailyRevisions(target, state.productId)[
                  kind === 'notes' && request.scope === 'product'
                    ? request.target?.id || state.productId || ''
                    : target
                ] || context.revision,
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
                const draft = current.choice === 'current' ? currentFacts : state;
                void tasks[kind]
                  .reconcile(
                    normalizeDailyDraft(draft),
                    fixtureDailyRevisions(target, state.productId),
                    normalizeDailyDraft(currentFacts),
                  )
                  .catch((error) => setStorageError(String(error)));
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
            recurring:
              state.dateDraft.kind === 'SERVICE_DUE' &&
              state.dateDraft.basis === '已记录的每 30 天检查计划',
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
    const trial = isTrial();
    const unsupported =
      (scenario === 'mcp' || scenario === 'unsupported-host') &&
      route.searchParams.get('host') !== 'web';
    const scopeKind = state.scope === 'product' ? 'CATALOG_NODE' : 'ITEM';
    const targetObject = state.scope === 'product' ? item?.skuId || '' : target;
    const visibleAttachments = state.attachments.filter(
      (attachment) => attachment.targetKind === scopeKind,
    );
    const visiblePending = state.pending.filter(
      (pending) => !pending.scope || pending.scope === state.scope,
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
    const records = getExtraReviewAttachments(targetObject) || [];
    function validateFiles(chosen: readonly File[]) {
      if (cap.kind !== 'available') return cap.reason;
      if (
        visibleAttachments.length +
          visiblePending.length +
          visibleTransfers.length +
          chosen.length >
        20
      )
        return '每个目标最多 20 个有效附件，包含当前待处理文件。';
      const knownBytes = Object.values(readAttachmentStore())
        .flat()
        .reduce((sum, record) => sum + record.fileSize, 0);
      const pendingBytes =
        state.pending.reduce((sum, pending) => sum + (pending.size || 0), 0) +
        state.transfers.reduce((sum, transfer) => sum + transfer.size, 0);
      if (
        knownBytes + pendingBytes + chosen.reduce((sum, file) => sum + file.size, 0) >
          5 * 1024 ** 3 ||
        scenario === 'quota-full'
      )
        return '示例家庭总容量已达到 5 GiB，尚未加入这些文件。';
      if (
        chosen.some(
          (file) =>
            !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) ||
            file.size > 25 * 1024 ** 2 ||
            file.size === 0,
        )
      )
        return '仅允许 JPEG / PNG / WebP / PDF，且每个文件需大于 0、最多 25 MiB。';
      return '';
    }
    function recordProductAttachmentHistory(
      requestKey: string,
      objectId: string,
      attachmentId: string,
      removing: boolean,
    ) {
      if (getReviewWorld().receipts[`${requestKey}:history`]) return;
      const revisionKey = `acornary-review-attachment-revision:${objectId}`;
      const revision = Number(reviewStorage.getItem(revisionKey) || '0');
      const eventId = uniqueId('event');
      appendReviewEvent(
        {
          ...baseHistory[0],
          operationLabel: removing ? '移除商品共有附件' : '关联商品共有附件',
          objectLabel: context.productLabel,
          event: {
            ...baseHistory[0].event!,
            id: eventId,
            operation_id: uniqueId('operation'),
            target_kind: 'CATALOG_NODE',
            target_id: objectId,
            event_type: removing ? 'ATTACHMENT_DETACH' : 'ATTACHMENT_ATTACH',
            before_revision: revision,
            after_revision: revision + 1,
            occurred_at: currentInstant,
            recorded_at: currentInstant,
            reason: '隔离试用附件集合变更；版本指此附件集合，不改实物资料。',
            changes: [
              {
                path: 'attachments',
                before_present: removing,
                after_present: !removing,
                ...(removing
                  ? { before: { attachment_id: attachmentId } }
                  : { after: { attachment_id: attachmentId } }),
              },
            ],
          },
        },
        `${requestKey}:history`,
      );
      reviewStorage.setItem(revisionKey, String(revision + 1));
    }
    async function associate(id: string, recover: boolean) {
      const transfer = state.transfers.find((value) => value.id === id);
      if (!transfer || cap.kind !== 'available' || commitBusy.current) return;
      const operationScope = scopeKey();
      const objectId = transfer.scope === 'product' ? item!.skuId : target;
      const requestKey = `associate:${transfer.id}`;
      const attachmentId = `attachment_${id.replace('upload_', '')}`;
      const record: StoredAttachment = {
        id: attachmentId,
        targetKind: transfer.scope === 'product' ? 'CATALOG_NODE' : 'ITEM',
        mimeType: transfer.mime,
        fileSize: transfer.size,
        width: transfer.sampleId === 'sample-label-photo' ? 480 : null,
        height: transfer.sampleId === 'sample-label-photo' ? 300 : null,
        caption: transfer.name,
        sortOrder: records.length,
        sensitivity: 'NORMAL',
        thumbnailUrl: null,
        name: transfer.name,
        localId: transfer.localId,
        sampleId: transfer.sampleId,
      };
      commitBusy.current = true;
      try {
        reviewStorage.setItem(
          `acornary-review-extra-attachment-request:${requestKey}`,
          JSON.stringify({
            key: requestKey,
            operation: 'associate',
            target: objectId,
            record,
            state: 'submitting',
          }),
        );
        await flushReviewStorage();
        if (operationScope !== scopeKey()) return;
        const currentRecords = getExtraReviewAttachments(objectId) || [];
        const nextRecords = currentRecords.some((value) => value.id === attachmentId)
          ? currentRecords
          : [...currentRecords, record];
        const loseReceipt = !recover && (scenario === 'unknown' || scenario === 'network-unknown');
        const nextState = {
          ...state,
          attachments: [
            ...state.attachments.filter(
              (attachment) => attachment.targetKind !== record.targetKind,
            ),
            ...nextRecords,
          ],
          attachmentNames: {
            ...state.attachmentNames,
            ...Object.fromEntries(nextRecords.map((value) => [value.id, value.name])),
          },
          attachmentLocalIds: {
            ...state.attachmentLocalIds,
            ...Object.fromEntries(nextRecords.map((value) => [value.id, value.localId])),
          },
          transfers: loseReceipt
            ? state.transfers.map((value) =>
                value.id === id ? { ...value, state: 'unknown' as const } : value,
              )
            : state.transfers.filter((value) => value.id !== id),
          attachmentMessage: loseReceipt
            ? '示例关联已执行但回执未送达；保留原上传引用，先核对原结果。'
            : `${transfer.name} 已保存附件${recover ? '，恢复的是原关联结果' : ''}。`,
        };
        runReviewTransaction(() => {
          publishAttachments(objectId, nextRecords);
          const currentFacts = getReviewWorld().items.find((value) => value.item.id === target);
          const patches =
            transfer.scope === 'item' && currentFacts
              ? [
                  {
                    ...currentFacts,
                    item: { ...currentFacts.item, attachmentCount: nextRecords.length },
                  },
                ]
              : [];
          updateReviewItems(patches, { requestKey, operationLabel: '关联附件' });
          if (transfer.scope === 'product')
            recordProductAttachmentHistory(requestKey, objectId, attachmentId, false);
          reviewStorage.setItem(
            `acornary-review-extra-attachment-request:${requestKey}`,
            JSON.stringify({
              key: requestKey,
              operation: 'associate',
              target: objectId,
              record,
              state: loseReceipt ? 'networkUnknown' : 'success',
            }),
          );
          saveDailyView(storageKey, nextState);
        });
        await flushReviewStorage();
        if (operationScope === scopeKey()) setState(nextState);
      } catch {
        if (operationScope === scopeKey())
          fail('附件关联未能完成持久化；原引用仍保留，请核对后重试原关联。');
      } finally {
        commitBusy.current = false;
      }
    }
    async function removeAttachment() {
      if (!removeId || cap.kind !== 'available' || commitBusy.current) return;
      const operationScope = scopeKey();
      const requestKey = `remove-attachment:${removeId}`;
      commitBusy.current = true;
      try {
        reviewStorage.setItem(
          `acornary-review-extra-attachment-request:${requestKey}`,
          JSON.stringify({
            key: requestKey,
            operation: 'remove',
            target: targetObject,
            attachmentId: removeId,
            state: 'submitting',
          }),
        );
        await flushReviewStorage();
        if (operationScope !== scopeKey()) return;
        const nextRecords = (getExtraReviewAttachments(targetObject) || []).filter(
          (record) => record.id !== removeId,
        );
        const nextState = {
          ...state,
          attachments: state.attachments.filter((attachment) => attachment.id !== removeId),
          attachmentMessage: '已移除此对象的附件关联。',
        };
        runReviewTransaction(() => {
          publishAttachments(targetObject, nextRecords);
          const currentFacts = getReviewWorld().items.find((value) => value.item.id === target);
          const patches =
            state.scope === 'item' && currentFacts
              ? [
                  {
                    ...currentFacts,
                    item: { ...currentFacts.item, attachmentCount: nextRecords.length },
                  },
                ]
              : [];
          updateReviewItems(patches, { requestKey, operationLabel: '移除附件关联' });
          if (state.scope === 'product')
            recordProductAttachmentHistory(requestKey, targetObject, removeId, true);
          reviewStorage.setItem(
            `acornary-review-extra-attachment-request:${requestKey}`,
            JSON.stringify({
              key: requestKey,
              operation: 'remove',
              target: targetObject,
              attachmentId: removeId,
              state: 'success',
            }),
          );
          saveDailyView(storageKey, nextState);
        });
        await flushReviewStorage();
        if (operationScope === scopeKey()) {
          setState(nextState);
          setRemoveId(null);
          if (previewId === removeId) {
            setPreviewId(null);
            setPreviewUrl(null);
          }
        }
      } catch {
        if (operationScope === scopeKey())
          fail('移除结果未能完成持久化；请保留当前对象后核对原请求。');
      } finally {
        commitBusy.current = false;
      }
    }
    function openAttachment(attachment: AttachmentView) {
      const record = records.find((value) => value.id === attachment.id);
      const file = record?.sampleId
        ? sampleFile(record.sampleId)
        : files.current.get(record?.localId || state.attachmentLocalIds[attachment.id]);
      if (!file) {
        fail('已读取附件摘要；本机文件内容未保留，当前无法下载。');
        return;
      }
      const url = URL.createObjectURL(file);
      if (file.type !== 'application/pdf') {
        setPreviewId(attachment.id);
        setPreviewUrl(url);
        return;
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = record?.name || file.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      fail(`${file.name} 已交给浏览器下载；PDF 不生成缩略图。`);
    }
    return (
      <>
        {notice}
        <DailyExtras
          {...common}
          surface="attachments"
          model={{
            scopeLabel: `${state.scope === 'product' ? '商品共有附件' : '仅此件附件'} · ${context.itemLabel}`,
            quotaLabel: `当前目标 ${visibleAttachments.length} / 20；此家庭样例占用 ${Math.ceil(
              Object.values(readAttachmentStore())
                .flat()
                .reduce((sum, record) => sum + record.fileSize, 0) / 1024,
            )} KiB。`,
            ...(trial && !unsupported
              ? {
                  samples,
                  sampleSelectionDisabled: cap.kind !== 'available',
                  onChooseSample: (sampleId: string) => {
                    if (!samples.some((sample) => sample.id === sampleId)) return;
                    const file = sampleFile(sampleId);
                    const error = validateFiles([file]);
                    if (error) {
                      fail(error);
                      return;
                    }
                    const transfer: Transfer = {
                      id: uniqueId('upload'),
                      localId: `builtin:${sampleId}`,
                      sampleId,
                      name: file.name,
                      mime: file.type,
                      size: file.size,
                      scope: state.scope,
                      state: 'uploaded',
                    };
                    change((current) => ({
                      ...current,
                      transfers: [...current.transfers, transfer],
                      attachmentMessage: '内置样例已准备，确认关联后才成为此对象的附件。',
                    }));
                  },
                  showField: false,
                  preparedLabel: '样例已准备，尚未关联',
                }
              : {}),
            preview:
              previewId && previewUrl ? (
                <img
                  className="vn-extra-attachment-preview"
                  src={previewUrl}
                  alt={state.attachmentNames[previewId] || '附件预览'}
                />
              ) : undefined,
            onClosePreview: () => {
              setPreviewId(null);
              setPreviewUrl(null);
            },
            field: {
              capability: cap,
              allowLocalSelection: !unsupported && !trial,
              pending: visiblePending,
              onFilesSelected: (chosen) => {
                if (trial) return;
                const error = validateFiles(chosen);
                if (error) {
                  fail(error);
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
                  attachmentMessage: '文件只保留在当前浏览器内，尚未关联。',
                }));
              },
              onUploadIntent:
                unsupported || trial
                  ? undefined
                  : (ids) => {
                      if (cap.kind !== 'available') return;
                      change((current) => {
                        const chosen = current.pending.filter((pending) =>
                          ids.includes(pending.id),
                        );
                        if (chosen.some((pending) => !files.current.has(pending.id)))
                          return {
                            ...current,
                            attachmentMessage: '本机文件未恢复；请重新选择。原上传引用仍保留。',
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
                          attachmentMessage: '示例文件准备完成，尚未关联；没有上传到外部服务。',
                        };
                      });
                    },
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
              onOpen: openAttachment,
              onRemove: (attachment) => setRemoveId(attachment.id),
            },
            transfers: visibleTransfers.map((transfer) => ({
              id: transfer.id,
              name: transfer.name,
              state: transfer.state,
              disabled: cap.kind !== 'available',
              onAssociate: () => {
                void associate(transfer.id, false);
              },
              onRecover: () => {
                void associate(transfer.id, true);
              },
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
              void removeAttachment();
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
  const startPrinting = async (ids: readonly string[]) => {
    if (
      availability.kind !== 'available' ||
      commitBusy.current ||
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
    const operationScope = scopeKey();
    const next = {
      ...state,
      queue,
      pages: state.pages.map((page) =>
        page.pageId === first ? { ...page, status: 'sending' as const } : page,
      ),
    };
    commitBusy.current = true;
    try {
      saveDailyView(storageKey, next);
      await flushReviewStorage();
      if (operationScope === scopeKey()) setState(next);
    } catch {
      if (operationScope === scopeKey()) setStorageError('标签任务未能保存，尚未开始发送。');
    } finally {
      commitBusy.current = false;
    }
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
            onConnect: () => {
              if (availability.kind === 'available')
                change((current) => ({ ...current, connection: 'connected' }));
            },
            onPrintUnsent: startPrinting,
            onStop: () => change((current) => ({ ...current, queue: [] })),
            onInspectPage: setInspectPage,
            onConfirmPaper: (id) =>
              availability.kind === 'available' &&
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
            if (availability.kind !== 'available') return;
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
      key={`${scopeKey()}:${target}:${isTrial() ? 'trial' : scenario}`}
      path={path}
      scenario={scenario}
      navigate={navigate}
      target={target}
    />
  );
}
