import { applyReviewTask, useReviewWorld } from './inventory-session';
import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import {
  DailyTask,
  type DailyTaskDraft,
  type DailyTaskKind,
} from '../../src/features/daily/pages/daily-task';
import { Button } from '../../src/ui/components/ui/button';
import { ApprovalSummary } from '../../src/ui/patterns/approval-summary';
import { ConflictResolution } from '../../src/ui/patterns/conflict-resolution';
import type { OperationState } from '../../src/ui/patterns/types';
import { productFactsFor, locationOptions, emptyProduct } from './fixtures';
const titles = {
  intake: '已有商品入库',
  'new-product': '新商品入库',
  consume: '记录使用',
  move: '移动物品',
};
export function TaskJourney({
  kind,
  scenario,
  target,
  onBack,
  onSwitch,
}: {
  kind: DailyTaskKind;
  scenario: string;
  target?: string;
  onBack: () => void;
  onSwitch: (kind: DailyTaskKind) => void;
}) {
  const { items: itemFacts } = useReviewWorld();
  const item = itemFacts.find((f) => f.item.id === target) || (!target ? itemFacts[0] : null);
  const products = [
    ...productFactsFor(itemFacts),
    ...(itemFacts.some((f) => f.item.skuId === emptyProduct.group.id) ? [] : [emptyProduct]),
  ];
  const product = products.find((p) => p.group.id === target);
  const key = `acornary-review-p03:${kind}:${target || 'default'}:${scenario}`;
  const initial: DailyTaskDraft = {
    name: '',
    count: '1',
    catalog: product
      ? { id: product.group.id, kind: 'SKU', name: product.group.name, path: product.catalogPath }
      : null,
    location: { kind: 'unknown' },
    quantity: { value: null, unit: item?.quantity.unit || 'mL', accuracy: 'unknown' },
    finish: false,
    dates: [],
  };
  const [draft, setDraft] = useState(initial);
  const [state, setState] = useState<OperationState>('draft');
  const [open, setOpen] = useState(true),
    [reviewing, setReviewing] = useState(false),
    [error, setError] = useState('');
  const [catalogQuery, setCatalogQuery] = useState(''),
    [locationQuery, setLocationQuery] = useState('');
  const [request, setRequest] = useState<{ key: string; draft: DailyTaskDraft } | null>(null);
  const [approved, setApproved] = useState(false),
    [revision, setRevision] = useState(item?.item.revision || 1);
  const [choice, setChoice] = useState<'current' | 'input' | undefined>();
  const [receipt, setReceipt] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        setDraft(saved.draft);
        setRequest(saved.request);
        setState(saved.state === 'submitting' ? 'networkUnknown' : saved.state);
        setReviewing(saved.reviewing);
        setReceipt(saved.receipt || []);
        return;
      }
    } catch {
      setError('本地草稿不可用；发送前必须能够保存原请求。');
    }
    setState(
      (
        {
          offline: 'offline',
          forbidden: 'forbidden',
          'session-changed': 'sessionChanged',
        } as Record<string, OperationState>
      )[scenario] || 'draft',
    );
  }, [key, scenario]);
  function persist(
    nextState = state,
    nextDraft = draft,
    nextRequest = request,
    nextReview = reviewing,
    nextReceipt = receipt,
  ) {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          draft: nextDraft,
          request: nextRequest,
          state: nextState,
          reviewing: nextReview,
          receipt: nextReceipt,
        }),
      );
      return true;
    } catch {
      setError('无法保存任务，未发送。请恢复存储后重试。');
      return false;
    }
  }
  const patch = (next: DailyTaskDraft) => {
    setDraft(next);
    setApproved(false);
    persist('draft', next, null, false);
  };
  const location =
    draft.location.kind === 'item'
      ? draft.location.path.join(' › ')
      : draft.location.kind === 'root'
        ? '移出容器 / 未指定位置'
        : '位置未记录';
  const remaining =
    kind === 'consume' &&
    !draft.finish &&
    item?.quantity.value &&
    /^\d+(\.\d+)?$/.test(draft.quantity.value || '')
      ? new Decimal(item.quantity.value).minus(draft.quantity.value!).toString()
      : null;
  const summary =
    state === 'success'
      ? receipt
      : [
          kind === 'intake' || kind === 'new-product'
            ? `${kind === 'new-product' ? draft.name : draft.catalog?.name || '未选商品'} · ${draft.count} 件`
            : `${item?.item.name || '对象不可用'} · ${item?.item.id || ''}`,
          ...(kind === 'consume'
            ? [
                draft.finish
                  ? '整件用完'
                  : `本次使用 ${draft.quantity.value || '未填写'} ${draft.quantity.unit} · ${draft.quantity.accuracy === 'estimated' ? '估计' : draft.quantity.accuracy === 'measured' ? '实测' : '依据未记录'}`,
              ]
            : [`目标位置：${location}`]),
          ...(remaining !== null
            ? [`核对后剩余：${remaining} ${item?.quantity.unit}（计算预览，依据沿用原事实）`]
            : []),
          ...(kind === 'move'
            ? [`原位置：${item?.item.location.path.join(' › ') || '未记录'}`]
            : []),
          ...(kind === 'new-product'
            ? [`商品分类：${draft.catalog?.path.join(' › ') || '未选择'}`]
            : []),
          ...draft.dates
            .slice(0, Number(draft.count))
            .flatMap((d, i) => (d ? [`第 ${i + 1} 件最佳食用期：${d} · 包装标注`] : [])),
        ];
  function validate() {
    if ((kind === 'consume' || kind === 'move') && !item) return '目标物品不可用。';
    if (kind === 'intake' || kind === 'new-product') {
      if (!/^\d+$/.test(draft.count) || Number(draft.count) < 1 || Number(draft.count) > 100)
        return '件数须为 1–100 的整数。';
      if (!draft.catalog) return kind === 'intake' ? '请选择已有商品。' : '请选择完整商品分类。';
      if (kind === 'new-product' && !draft.name.trim()) return '请填写商品名称。';
      if (kind === 'new-product' && products.some((p) => p.group.name.includes(draft.name.trim())))
        return '已有相似商品，请返回已有商品入库核对。';
    }
    if (kind === 'move' && draft.location.kind === 'unknown')
      return '请选择目标位置或明确移出容器。';
    if (kind === 'consume' && !draft.finish) {
      if (!item?.quantity.value) return '剩余量未知，不能核对部分使用；可选择整件用完。';
      if (
        !/^\d+(\.\d+)?$/.test(draft.quantity.value || '') ||
        new Decimal(draft.quantity.value || 0).lte(0) ||
        new Decimal(draft.quantity.value || 0).gt(item.quantity.value)
      )
        return '使用数量须大于零且不超过当前剩余量。';
    }
    return '';
  }
  function finish() {
    if (!request) {
      setError('原请求未保存，无法恢复。');
      return;
    }
    let ids: string[];
    try {
      ids = applyReviewTask(request.key, kind, request.draft, target);
    } catch {
      setError('无法保存预览结果，原请求仍保留。');
      setState('networkUnknown');
      return;
    }
    const result = [
      '预览结果 · 已更新隔离数据，未写入正式库存',
      ...summary,
      ...(kind === 'new-product' ? [`示例新商品：catalog_node_${request?.key}`] : []),
      ...ids.map((id) => `示例物品：${id}`),
    ];
    setReceipt(result);
    setState('success');
    persist('success', draft, request, true, result);
  }
  useEffect(() => {
    if (state !== 'submitting') return;
    const timer = setTimeout(() => {
      if (scenario === 'unknown') {
        setState('networkUnknown');
        persist('networkUnknown');
      } else finish();
    }, 800);
    return () => clearTimeout(timer);
  }, [state]);
  function action(id: string) {
    if (id === 'edit') {
      setReviewing(false);
      setState('draft');
      return;
    }
    if (id === 'recover') {
      finish();
      return;
    }
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      setState('validationError');
      return;
    }
    setError('');
    if (!reviewing) {
      setReviewing(true);
      persist('draft', draft, request, true);
      return;
    }
    if (kind === 'new-product' && !approved) {
      setState('approvalRequired');
      return;
    }
    if (scenario === 'conflict' && revision === (item?.item.revision || 1)) {
      setState('revisionConflict');
      return;
    }
    if (scenario === 'contract-gap' && kind === 'new-product') {
      setError('当前原子入库契约无法同时声明新商品类型与能力。草稿已保留。');
      persist();
      return;
    }
    const original = request || { key: crypto.randomUUID(), draft: structuredClone(draft) };
    if (!persist('submitting', draft, original, true)) return;
    setRequest(original);
    setState('submitting');
  }
  return (
    <DailyTask
      kind={kind}
      title={titles[kind]}
      taskId={key}
      state={state}
      draft={draft}
      onChange={patch}
      item={item}
      catalogCandidates={
        kind === 'new-product'
          ? [
              {
                id: 'catalog_node_99999999-0000-4000-8000-000000000001',
                kind: 'GROUP',
                name: '食品饮料',
                path: ['日用消耗品', '食品饮料'],
              },
            ]
          : products.map((p) => ({
              id: p.group.id,
              kind: 'SKU',
              name: p.group.name,
              path: [...p.catalogPath, p.group.name],
            }))
      }
      locations={locationOptions.map((l) => ({
        itemId: l.id,
        name: l.label,
        path: l.label.split(' › '),
        source: '隔离样例',
        eligibility:
          l.id === item?.item.id
            ? { kind: 'cycle', reason: '不能移动到自身' }
            : { kind: 'validContainer' },
      }))}
      catalogQuery={catalogQuery}
      onCatalogQuery={setCatalogQuery}
      locationQuery={locationQuery}
      onLocationQuery={setLocationQuery}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => {
        if (persist()) setOpen(false);
      }}
      onBack={onBack}
      reviewing={reviewing}
      error={error}
      summary={summary}
      actions={
        state === 'networkUnknown'
          ? [{ id: 'recover', label: '核对原请求', kind: 'retry-original' }]
          : ['draft', 'validationError'].includes(state)
            ? [
                ...(reviewing
                  ? [
                      {
                        id: 'edit',
                        label: '修改',
                        kind: 'other' as const,
                        variant: 'secondary' as const,
                      },
                    ]
                  : []),
                { id: 'next', label: reviewing ? '确认' : '核对', kind: 'submit' },
              ]
            : []
      }
      onAction={action}
      recovery={
        <>
          {state === 'success' && (
            <Button
              variant="quiet"
              onClick={() => {
                setDraft(initial);
                setState('draft');
                setRequest(null);
                setReceipt([]);
                setReviewing(false);
                setApproved(false);
                setError('');
                persist('draft', initial, null, false, []);
              }}
            >
              开始新样例
            </Button>
          )}
          {state === 'draft' && !reviewing && (kind === 'intake' || kind === 'new-product') && (
            <Button
              variant="quiet"
              onClick={() => {
                if (persist()) onSwitch(kind === 'intake' ? 'new-product' : 'intake');
              }}
            >
              {kind === 'intake' ? '没有合适商品，创建新商品' : '选择已有商品'}
            </Button>
          )}
          {state === 'networkUnknown' && (
            <p>原请求：{request?.key || '未记录'} · 将核对原参数，不重新创建请求。</p>
          )}

          {state === 'submitting' && (
            <>
              <p>测试适配器等待返回，不调用业务服务。</p>
              <Button
                onClick={() => {
                  if (scenario === 'unknown') {
                    setState('networkUnknown');
                    persist('networkUnknown');
                  } else finish();
                }}
              >
                接收示例响应
              </Button>
            </>
          )}
          {state === 'approvalRequired' && (
            <ApprovalSummary
              proposal={{
                proposalId: key,
                householdLabel: '梧桐之家 · 示例',
                scope: 'THIS_OPERATION_ONLY',
                policyRevision: 1,
                expiresAtLabel: '本次预览会话',
                validity: 'valid',
                status: 'awaiting',
                impact: summary,
                summary: '创建商品及本批实物',
              }}
              availability={{ kind: 'available' }}
              onRequestReview={() => {}}
              onRevise={() => {
                setState('draft');
                setReviewing(false);
              }}
              onConfirm={() => {
                setApproved(true);
                setState('draft');
              }}
            />
          )}
          {state === 'revisionConflict' && (
            <ConflictResolution
              objectId={item!.item.id}
              scopeLabel="当前记录已更新，原输入保留"
              originalRevision={revision}
              currentRevision={revision + 1}
              fields={[
                {
                  key: 'revision',
                  label: '记录版本',
                  original: { kind: 'known', text: String(revision) },
                  current: { kind: 'known', text: String(revision + 1) },
                  input: { kind: 'known', text: summary.join('；') },
                },
              ]}
              choices={{ revision: choice }}
              availability={{ kind: 'available' }}
              onChoose={(_, value) => setChoice(value)}
              onRefresh={() => setError('已读取示例最新版本，请核对并选择。')}
              onReconfirm={() => {
                setRevision(revision + 1);
                setState('draft');
                setReviewing(false);
                setRequest(null);
                if (choice === 'current') setDraft(initial);
              }}
            />
          )}
        </>
      }
    />
  );
}
