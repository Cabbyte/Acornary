import { trialProducts } from '../trial/products';
import { isTrial } from '../trial/session';
import {
  createFixtureSession,
  executeFixtureAttempt,
  freezeFixtureAttempt,
  getFixtureScope,
} from '../trial/application';
import { useOperationSessions } from '../../src/app-vnext/operation-context';
import { useReviewWorld } from './inventory-session';
import { useState, useSyncExternalStore } from 'react';
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
  const { items: itemFacts, receipts } = useReviewWorld();
  const item = itemFacts.find((f) => f.item.id === target) || (!target ? itemFacts[0] : null);
  const products = [
    ...trialProducts(itemFacts),
    ...(!isTrial() && !itemFacts.some((f) => f.item.skuId === emptyProduct.group.id)
      ? [emptyProduct]
      : []),
  ];
  const product = products.find((p) => p.group.id === target);
  const key = `acornary-review-p03:${kind}:${target || 'default'}:${isTrial() ? 'trial' : scenario}`;
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
  const sessions = useOperationSessions();
  const session = sessions.get(getFixtureScope(), key, () =>
    createFixtureSession(
      key,
      initial,
      item?.item.id || target,
      item?.item.revision,
      scenario,
      kind,
    ),
  );
  const record = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { draft, reviewing, error } = record;
  const state: OperationState = ['draft', 'validationError'].includes(record.state)
    ? (
        {
          offline: 'offline',
          forbidden: 'forbidden',
          'session-changed': 'sessionChanged',
        } as Record<string, OperationState>
      )[scenario] || record.state
    : record.state;
  const request = record.attempt;
  const receipt = record.result || [];
  const approved = !!record.approval;
  const revision = (item && record.revisions[item.item.id]) || item?.item.revision || 1;
  const [open, setOpen] = useState(true);
  const [catalogQuery, setCatalogQuery] = useState(''),
    [locationQuery, setLocationQuery] = useState('');
  const [choice, setChoice] = useState<'current' | 'input' | undefined>();
  const [conflictReviewed, setConflictReviewed] = useState(false);
  const setError = (error: string) => void session.update({ error });
  const patch = (next: DailyTaskDraft) =>
    void session.update({
      draft: next,
      approval: null,
      reviewing: false,
      state: 'draft',
      error: '',
    });
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
      ? request && receipts[request.key]
        ? item.quantity.value
        : new Decimal(item.quantity.value).minus(draft.quantity.value!).toString()
      : null;
  const summary =
    state === 'success'
      ? receipt
      : request?.reviewSummary && ['submitting', 'networkUnknown'].includes(state)
        ? request.reviewSummary
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
  const execute = (recovering: boolean) => (attempt: NonNullable<typeof request>) =>
    executeFixtureAttempt(record.scope, kind, target, attempt, scenario, recovering);
  function action(id: string) {
    if (id === 'edit') {
      void session.update({ reviewing: false, state: 'draft' });
      return;
    }
    if (id === 'recover') {
      void session.recover(execute(true));
      return;
    }
    const invalid = validate();
    if (invalid) {
      void session.update({ error: invalid, state: 'validationError' });
      return;
    }
    if (!reviewing) {
      void session.update({ reviewing: true, error: '' });
      return;
    }
    if (kind === 'new-product' && !approved) {
      void session.update({ state: 'approvalRequired' });
      return;
    }
    if (scenario === 'conflict' && !conflictReviewed) {
      void session.update({ state: 'revisionConflict' });
      return;
    }
    if (scenario === 'contract-gap' && kind === 'new-product') {
      setError('当前原子入库契约无法同时声明新商品类型与能力。草稿已保留。');
      return;
    }
    try {
      const original =
        request ||
        freezeFixtureAttempt(
          kind,
          draft,
          item?.item.id || target,
          item ? record.revisions[item.item.id] : undefined,
          summary,
        );
      void session.submit(original, execute(false));
    } catch (error) {
      setError(String(error));
    }
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
      locations={(isTrial()
        ? itemFacts
            .filter(
              (f) =>
                f.item.skuId === 'catalog_node_00000000-0000-4000-8000-000000000800' &&
                f.item.recordState === 'VALID',
            )
            .map((f) => ({
              id: f.item.id,
              label: [...f.item.location.path, f.item.name].join(' › '),
            }))
        : locationOptions
      ).map((l) => ({
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
      onClose={async () => {
        if ((await session.retain()) && state !== 'submitting') {
          setOpen(false);
          if (isTrial()) onBack();
        }
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
                void session
                  .restart(initial, item ? { [item.item.id]: item.item.revision } : {})
                  .catch((error) => setError(String(error)));
              }}
            >
              开始新样例
            </Button>
          )}
          {state === 'draft' && !reviewing && (kind === 'intake' || kind === 'new-product') && (
            <Button
              variant="quiet"
              onClick={() => {
                onSwitch(kind === 'intake' ? 'new-product' : 'intake');
              }}
            >
              {kind === 'intake' ? '没有合适商品，创建新商品' : '选择已有商品'}
            </Button>
          )}
          {state === 'networkUnknown' && (
            <p>原请求：{request?.key || '未记录'} · 将核对原参数，不重新创建请求。</p>
          )}

          {state === 'submitting' && <p>测试适配器等待返回，不调用业务服务。</p>}
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
                void session.update({ state: 'draft', reviewing: false });
              }}
              onConfirm={() => {
                void session.update({ approval: { id: key, revision: 1 }, state: 'draft' });
              }}
            />
          )}
          {state === 'revisionConflict' && item && (
            <ConflictResolution
              objectId={item!.item.id}
              scopeLabel="当前记录已更新，原输入保留"
              originalRevision={revision}
              currentRevision={item.item.revision}
              fields={[
                {
                  key: 'revision',
                  label: '记录版本',
                  original: { kind: 'known', text: String(revision) },
                  current: { kind: 'known', text: String(item.item.revision) },
                  input: { kind: 'known', text: summary.join('；') },
                },
              ]}
              choices={{ revision: choice }}
              availability={{ kind: 'available' }}
              onChoose={(_, value) => setChoice(value)}
              onRefresh={() => setError('已读取示例最新版本，请核对并选择。')}
              onReconfirm={() => {
                if (!choice) {
                  setError('请先选择保留当前事实或原输入。');
                  return;
                }
                setConflictReviewed(true);
                void session
                  .reconcile(
                    choice === 'current' ? initial : draft,
                    { [item.item.id]: item.item.revision },
                    initial,
                  )
                  .catch((error) => setError(String(error)));
              }}
            />
          )}
        </>
      }
    />
  );
}
