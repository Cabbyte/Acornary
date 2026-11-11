import { ReviewNote, ReviewFeedback } from '../review-frame';
import { useEffect, useState, type ReactNode } from 'react';
import type { WriteResultV2 } from '../../../../packages/contracts/src/read-v2';
import type { ReviewDemoProps, ReviewEntry, ReviewScenario } from '../types';
import { Button } from '../../src/ui/components/ui/button';
import { Input } from '../../src/ui/components/ui/input';
import { FormField } from '../../src/ui/components/ui/form-field';
import { InlineNotice } from '../../src/ui/components/ui/inline-notice';
import { ApprovalSummary, type ApprovalPresentation } from '../../src/ui/patterns/approval-summary';
import { ConflictResolution, type ConflictField } from '../../src/ui/patterns/conflict-resolution';
import {
  OperationReceipt,
  type OperationReceiptProps,
} from '../../src/ui/patterns/operation-receipt';
import {
  PendingOperationBanner,
  type PendingOperationBannerProps,
} from '../../src/ui/patterns/pending-operation-banner';
import { OfflineBanner } from '../../src/ui/patterns/offline-banner';
import { DraftStatus, type DraftStatusProps } from '../../src/ui/patterns/draft-status';
import { OperationSheet } from '../../src/ui/patterns/operation-sheet';
import { CapabilityNotice } from '../../src/ui/patterns/capability-notice';
import { ScanInput, type ScanCandidate, type ScanResult } from '../../src/ui/patterns/scan-input';
import {
  LabelPrintPanel,
  type PrintPagePresentation,
  type PrintPageStatus,
} from '../../src/ui/patterns/label-print-panel';
import { EmptyState } from '../../src/ui/patterns/empty-state';
import { LoadingState } from '../../src/ui/patterns/loading-state';
import type { ActionAvailability, OperationState } from '../../src/ui/patterns/types';

// Static, review-only data. No challenge, request payload, device or business service is used.
const itemA = 'item_11111111-1111-4111-8111-000000000001';
const itemB = 'item_11111111-1111-4111-8111-000000000002';
const taskId = 'task_22222222-2222-4222-8222-000000000001';
const proposalId = '33333333-3333-4333-8333-000000000001';
const household = '山间小屋 · 当前家庭';
const longText =
  '厨房北侧高柜第二层的透明密封收纳盒，保留了每件物品的完整身份、来源说明与原始位置；这段较长的说明用于检查折行和窄屏下的操作可达性，不应截断影响范围或未知状态。';
const available: ActionAvailability = { kind: 'available' };
const offline: ActionAvailability = {
  kind: 'offline',
  reason: '当前没有网络连接，请恢复连接后重新核对。',
};
export const receiptFixture: WriteResultV2 = {
  operation_id: 'operation_44444444-4444-4444-8444-000000000001',
  changed: true,
  affected_objects: [{ kind: 'ITEM', id: itemA, before_revision: 4, after_revision: 5 }],
  event_ids: ['event_55555555-5555-4555-8555-000000000001'],
  summary: '移动一件物品到客厅侧柜。',
};
function PreviewNote({ children }: { children?: ReactNode }) {
  return <ReviewNote>{children}</ReviewNote>;
}
function DemoLog({ children }: { children: ReactNode }) {
  return <ReviewFeedback>{children}</ReviewFeedback>;
}
function useDemoLog(scenario: string) {
  const [message, setMessage] = useState('尚未触发操作。');
  useEffect(() => setMessage('尚未触发操作。'), [scenario]);
  return [message, setMessage] as const;
}

export const approvalScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '待确认' },
  { id: 'long-term', label: '长期规则' },
  { id: 'expired', label: '已过期' },
  { id: 'unknown', label: '有效性未知' },
  { id: 'busy', label: '确认处理中' },
  { id: 'offline', label: '离线' },
  { id: 'approved', label: '已有批准结果' },
  { id: 'long-text', label: '长文本' },
];
export function ApprovalSummaryDemo({ scenario }: ReviewDemoProps) {
  const [message, log] = useDemoLog(scenario);
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => setReviewed(false), [scenario]);
  const proposal: ApprovalPresentation = {
    proposalId,
    householdLabel: household,
    scope: scenario === 'long-term' ? 'LONG_TERM_RULE' : 'THIS_OPERATION_ONLY',
    policyRevision: scenario === 'unknown' && !reviewed ? null : 7,
    expiresAtLabel: scenario === 'expired' && !reviewed ? '2026-11-06 19:00（演示）' : null,
    validity: reviewed
      ? 'valid'
      : scenario === 'expired'
        ? 'expired'
        : scenario === 'unknown'
          ? 'unknown'
          : 'valid',
    status: scenario === 'approved' ? 'approved' : 'awaiting',
    impact: [
      scenario === 'long-term' ? '保存为此家庭的长期分类规则。' : '仅批准当前提案的分类变更范围。',
      '不会以批准状态替代业务操作回执。',
    ],
    summary: scenario === 'long-text' ? longText : '核对饮品分类调整的影响范围。',
  };
  return (
    <div className="vn-stack">
      <PreviewNote />
      <ApprovalSummary
        proposal={proposal}
        availability={scenario === 'offline' ? offline : available}
        busy={scenario === 'busy'}
        onRequestReview={(id) => {
          setReviewed(true);
          log(`已加载可核对的演示提案：${id}。未生成 challenge。`);
        }}
        onConfirm={(id) => log(`已收到确认范围意图：${id}。未调用审批接口。`)}
        onRevise={(id) => log(`已收到返回修改意图：${id}。`)}
      />
      <DemoLog>{message}</DemoLog>
    </div>
  );
}

export const conflictScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '三方对比' },
  { id: 'unknown', label: '最新值未知' },
  { id: 'redacted', label: '内容不可见' },
  { id: 'busy', label: '重新读取中' },
  { id: 'offline', label: '离线' },
  { id: 'empty', label: '对比资料缺失' },
  { id: 'long-text', label: '长文本' },
];
export function ConflictResolutionDemo({ scenario }: ReviewDemoProps) {
  const [message, log] = useDemoLog(scenario);
  const [choices, setChoices] = useState<Record<string, 'current' | 'input' | undefined>>({});
  const [refreshed, setRefreshed] = useState(false);
  useEffect(() => {
    setChoices({});
    setRefreshed(false);
  }, [scenario]);
  const fields: ConflictField[] =
    scenario === 'empty' && !refreshed
      ? []
      : [
          {
            key: 'name',
            label: '名称',
            original: { kind: 'known', text: '收纳盒' },
            current:
              scenario === 'unknown' && !refreshed
                ? { kind: 'unknown' }
                : scenario === 'redacted'
                  ? { kind: 'redacted' }
                  : { kind: 'known', text: '透明收纳盒' },
            input: { kind: 'known', text: scenario === 'long-text' ? longText : '餐具收纳盒' },
          },
          {
            key: 'location',
            label: '位置',
            original: { kind: 'known', text: '厨房' },
            current: { kind: 'known', text: '客厅侧柜' },
            input: { kind: 'known', text: '餐厅高柜' },
          },
        ];
  return (
    <div className="vn-stack">
      <PreviewNote />
      <ConflictResolution
        objectId={itemA}
        scopeLabel={household}
        originalRevision={4}
        currentRevision={scenario === 'unknown' && !refreshed ? null : refreshed ? 6 : 5}
        fields={fields}
        choices={choices}
        availability={scenario === 'offline' ? offline : available}
        busy={scenario === 'busy'}
        onChoose={(key, choice) => {
          setChoices((previous) => ({ ...previous, [key]: choice }));
          log(`已选择 ${key}：${choice}；原始输入和版本没有被覆盖。`);
        }}
        onRefresh={() => {
          setRefreshed(true);
          setChoices({});
          log('已加载新的对比 fixture，等待逐项重新确认。');
        }}
        onReconfirm={() => log('已收到重新确认所选意图；未发送业务命令。')}
      />
      <DemoLog>{message}</DemoLog>
    </div>
  );
}

export const receiptScenarios: readonly ReviewScenario[] = [
  { id: 'success', label: '实际结构回执 fixture' },
  { id: 'created', label: '新建对象' },
  { id: 'replay', label: '原结果重放' },
  { id: 'unchanged', label: '没有新增变更' },
  { id: 'refresh-error', label: '回执成功 / 刷新失败' },
  { id: 'unknown', label: '尚无回执' },
  { id: 'loading', label: '读取回执中' },
  { id: 'long-text', label: '长摘要' },
];
export function OperationReceiptDemo({ scenario }: ReviewDemoProps) {
  const [message, log] = useDemoLog(scenario);
  const [refreshState, setRefreshState] = useState<OperationReceiptProps['refreshState']>(
    scenario === 'refresh-error' ? 'error' : 'not-requested',
  );
  useEffect(
    () => setRefreshState(scenario === 'refresh-error' ? 'error' : 'not-requested'),
    [scenario],
  );
  const result: WriteResultV2 = {
    ...receiptFixture,
    changed: scenario !== 'unchanged',
    summary:
      scenario === 'long-text'
        ? longText
        : scenario === 'unchanged'
          ? '目标记录已经处于请求状态，没有新增变更。'
          : receiptFixture.summary,
    affected_objects:
      scenario === 'unchanged'
        ? []
        : scenario === 'created'
          ? [{ kind: 'ITEM', id: itemA, before_revision: 0, after_revision: 1 }]
          : receiptFixture.affected_objects,
    event_ids: scenario === 'unchanged' ? [] : receiptFixture.event_ids,
  };
  return (
    <div className="vn-stack">
      <PreviewNote>
        下面的回执严格使用 WriteResultV2 结构，但数据是静态演示 fixture，并非本次执行结果。
      </PreviewNote>
      <OperationReceipt
        result={scenario === 'unknown' ? null : result}
        loading={scenario === 'loading'}
        replay={scenario === 'replay' ? true : scenario === 'unknown' ? null : false}
        refreshState={refreshState}
        onOpenAffected={(id, kind) => log(`已收到查看 ${kind} ${id} 的意图。`)}
        onRefreshReads={() => {
          setRefreshState('fresh');
          log('已载入列表刷新完成的 fixture；没有重发写命令。');
        }}
        onDone={() => log('已收到关闭回执意图。')}
      />
      <DemoLog>{message}</DemoLog>
    </div>
  );
}

export const pendingScenarios: readonly ReviewScenario[] = [
  { id: 'unknown', label: '结果未知' },
  { id: 'retained', label: '已保留任务' },
  { id: 'recovering', label: '核对中' },
  { id: 'missing-attempt', label: '原请求资料缺失' },
  { id: 'offline', label: '离线不可恢复' },
  { id: 'long-text', label: '长任务摘要' },
];
export function PendingOperationBannerDemo({ scenario }: ReviewDemoProps) {
  const [message, log] = useDemoLog(scenario);
  const initial: PendingOperationBannerProps['state'] =
    scenario === 'retained'
      ? 'retained'
      : scenario === 'recovering'
        ? 'recovering'
        : 'networkUnknown';
  const [state, setState] = useState(initial);
  useEffect(() => setState(initial), [initial, scenario]);
  return (
    <div className="vn-stack">
      <PreviewNote />
      <PendingOperationBanner
        taskId={taskId}
        title={scenario === 'long-text' ? longText : '将物品移到客厅侧柜'}
        scopeLabel={household}
        state={state}
        originalAttemptAvailable={scenario !== 'missing-attempt'}
        recoveryAvailability={scenario === 'offline' ? offline : available}
        onInspectOriginal={(id) => log(`已收到核对原请求结果意图：${id}。`)}
        onRetryOriginal={(id) => log(`已收到恢复同一次请求意图：${id}。没有创建新键或新参数。`)}
        onRetainAndLeave={(id) => {
          setState('retained');
          log(`演示中已保留任务入口：${id}。`);
        }}
      />
      <DemoLog>{message}</DemoLog>
    </div>
  );
}

export const offlineScenarios: readonly ReviewScenario[] = [
  { id: 'partial', label: '部分缓存' },
  { id: 'cached-scope', label: '范围缓存快照' },
  { id: 'none', label: '没有缓存' },
  { id: 'pending', label: '离线且原结果未知' },
  { id: 'reconnecting', label: '正在重连' },
  { id: 'online', label: '已恢复连接' },
  { id: 'long-text', label: '长范围' },
];
export function OfflineBannerDemo({ scenario }: ReviewDemoProps) {
  const [message, log] = useDemoLog(scenario);
  const [online, setOnline] = useState(scenario === 'online');
  useEffect(() => setOnline(scenario === 'online'), [scenario]);
  return (
    <div className="vn-stack">
      <PreviewNote />
      <OfflineBanner
        online={online}
        scopeLabel={scenario === 'long-text' ? longText : '当前筛选：厨房内的有效记录'}
        coverage={
          scenario === 'none'
            ? 'none'
            : scenario === 'cached-scope'
              ? 'cached-scope'
              : 'cached-subset'
        }
        cachedAtLabel={scenario === 'none' ? null : '2026-11-06 18:30（演示）'}
        asOfChangeId={scenario === 'none' ? null : 'change_66666666-6666-4666-8666-000000000001'}
        pendingTaskId={scenario === 'pending' ? taskId : undefined}
        reconnecting={scenario === 'reconnecting'}
        onReconnect={() => {
          setOnline(true);
          log('已载入连接恢复 fixture；未连接网络、未发送业务操作。');
        }}
        onViewRecovery={(id) => log(`已收到打开待确认任务意图：${id}。`)}
      />
      <DemoLog>{message}</DemoLog>
    </div>
  );
}

export const draftScenarios: readonly ReviewScenario[] = [
  { id: 'saved', label: '草稿已保存' },
  { id: 'inMemory', label: '仅内存 / 禁止发送' },
  { id: 'persistFailed', label: '保存失败' },
  { id: 'saving', label: '保存中' },
  { id: 'long-text', label: '长作用域与错误' },
];
export function DraftStatusDemo({ scenario }: ReviewDemoProps) {
  const [message, log] = useDemoLog(scenario);
  const initial: DraftStatusProps['state'] =
    scenario === 'saved'
      ? 'saved'
      : scenario === 'saving'
        ? 'saving'
        : scenario === 'inMemory'
          ? 'inMemory'
          : 'persistFailed';
  const [state, setState] = useState(initial);
  useEffect(() => setState(initial), [initial, scenario]);
  return (
    <div className="vn-stack">
      <PreviewNote />
      <DraftStatus
        taskId={taskId}
        scopeLabel={scenario === 'long-text' ? longText : household}
        state={state}
        savedAtLabel="2026-11-06 18:40（演示）"
        reason={
          scenario === 'long-text'
            ? `${longText} 当前保存空间不足，输入仍保留在页面内。`
            : undefined
        }
        onRetryPersist={(id) => {
          setState('saved');
          log(`已载入草稿已保存 fixture：${id}。未访问本地存储。`);
        }}
      />
      <DemoLog>{message}</DemoLog>
    </div>
  );
}

export const operationStateScenarios: readonly ReviewScenario[] = [
  { id: 'initial', label: 'ST00 初始' },
  { id: 'loading', label: 'ST01 读取中' },
  { id: 'empty', label: 'ST02 空' },
  { id: 'draft', label: 'ST03 草稿' },
  { id: 'validating', label: 'ST04 核对中' },
  { id: 'approvalRequired', label: 'ST05 需要批准' },
  { id: 'submitting', label: 'ST06 提交中' },
  { id: 'success', label: 'ST07 回执' },
  { id: 'validationError', label: 'ST08 输入错误' },
  { id: 'revisionConflict', label: 'ST09 版本冲突' },
  { id: 'networkUnknown', label: 'ST10 结果未知' },
  { id: 'offline', label: 'ST11 离线' },
  { id: 'forbidden', label: 'ST12 不允许' },
  { id: 'sessionChanged', label: 'ST13 上下文变化' },
  { id: 'blocked', label: '明确禁止关闭' },
  { id: 'long-text', label: '长表单' },
];
export function OperationSheetDemo({ scenario }: ReviewDemoProps) {
  const [message, log] = useDemoLog(scenario);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('餐具收纳盒');
  const [state, setState] = useState<OperationState>(
    scenario === 'blocked' || scenario === 'long-text' ? 'draft' : (scenario as OperationState),
  );
  const [blocked, setBlocked] = useState(scenario === 'blocked');
  const [retained, setRetained] = useState(false);
  useEffect(() => {
    setOpen(false);
    setState(
      scenario === 'blocked' || scenario === 'long-text' ? 'draft' : (scenario as OperationState),
    );
    setBlocked(scenario === 'blocked');
    setRetained(false);
  }, [scenario]);
  useEffect(() => {
    if (!open || (state !== 'submitting' && state !== 'validating')) return;
    const timer = setTimeout(() => {
      setState('networkUnknown');
      log('演示驱动：等待 4 秒后载入结果未知场景。未执行真实请求。');
    }, 4000);
    return () => clearTimeout(timer);
  }, [open, state, log]);
  let content: ReactNode = (
    <FormField
      label="物品名称"
      error={state === 'validationError' ? '此演示要求名称包含位置用途，请核对输入。' : undefined}
    >
      <Input value={name} onChange={(event) => setName(event.target.value)} />
    </FormField>
  );
  if (state === 'loading') content = <LoadingState />;
  else if (state === 'empty')
    content = <EmptyState reason="empty" context="当前演示范围没有待处理对象。" />;
  else if (state === 'success')
    content = (
      <OperationReceipt
        result={receiptFixture}
        replay={false}
        refreshState="not-requested"
        onOpenAffected={(id) => log(`查看对象意图：${id}`)}
        onRefreshReads={() => log('收到刷新读取意图。')}
      />
    );
  else if (state === 'approvalRequired')
    content = (
      <InlineNotice tone="warning" title="需要先核对批准范围">
        此场景等待既有审批流程，未创建新的审批能力。
      </InlineNotice>
    );
  else if (state === 'revisionConflict')
    content = (
      <InlineNotice tone="warning" title="当前版本与原读取版本不一致">
        草稿仍保留，请重新读取并逐项核对。
      </InlineNotice>
    );
  return (
    <div className="vn-stack">
      <PreviewNote>
        操作面板使用同一任务引用；提交中和核对中场景会在 4
        秒后载入「结果未知」fixture，方便继续检查保留关闭路径。
      </PreviewNote>
      <div className="vn-row">
        <Button onClick={() => setOpen(true)}>
          {retained ? '恢复保留的任务面板' : '打开操作面板'}
        </Button>
      </div>
      <OperationSheet
        open={open}
        operation={{
          taskId,
          state,
          title: '调整物品名称',
          description: '请核对当前范围和输入，再继续当前任务。',
          scopeLabel: household,
          closePolicy: blocked
            ? 'blocked'
            : state === 'draft' || state === 'networkUnknown'
              ? 'retain'
              : 'allow',
        }}
        steps={[
          { id: 'scope', label: '核对范围', state: 'complete' },
          { id: 'edit', label: '编辑信息', state: 'current' },
          { id: 'result', label: '查看结果', state: 'pending' },
        ]}
        actions={
          blocked
            ? [{ id: 'release', label: '演示：解除阻断', kind: 'other' }]
            : [
                {
                  id: 'read',
                  label: state === 'networkUnknown' ? '核对原请求结果' : '重新读取',
                  kind: 'read',
                  variant: 'secondary',
                },
                { id: 'submit', label: '确认提交意图', kind: 'submit' },
              ]
        }
        onAction={(id) => {
          if (id === 'release') setBlocked(false);
          log(`已收到 ${id} 意图；没有执行业务请求。`);
        }}
        onClose={() => {
          setOpen(false);
          log('已关闭面板；本地草稿未清除。');
        }}
        onRetainAndClose={(id) => {
          setRetained(true);
          setOpen(false);
          log(`已保留并收起同一任务：${id}。`);
        }}
        onBack={() => log('已收到上一步意图。')}
        onCloseBlocked={(reason) => log(`关闭已拦截：${reason}`)}
        onReestablishContext={() => {
          setOpen(false);
          log('已收到重新建立合法连接上下文的意图，未重放旧任务。');
        }}
      >
        {(state === 'submitting' || state === 'validating') && (
          <p className="vn-muted">演示状态会在 4 秒后切换为结果未知。</p>
        )}
        {content}
        {scenario === 'long-text' && [1, 2, 3, 4].map((part) => <p key={part}>{longText}</p>)}
        <DemoLog>{message}</DemoLog>
      </OperationSheet>
      {state !== 'forbidden' && state !== 'sessionChanged' && (
        <p className="vn-muted">
          草稿仍为：{name} · {retained ? '保留入口可用' : '任务尚未收起保留'}
        </p>
      )}
      <DemoLog>{message}</DemoLog>
    </div>
  );
}

export const capabilityScenarios: readonly ReviewScenario[] = [
  { id: 'available', label: '能力可用' },
  { id: 'unsupportedHost', label: '宿主不支持' },
  { id: 'missingContract', label: '接口未提供' },
  { id: 'forbidden', label: '无权限' },
  { id: 'readOnly', label: '只读' },
  { id: 'offline', label: '离线' },
  { id: 'missingFacts', label: '信息缺失' },
  { id: 'blockedState', label: '状态阻断' },
  { id: 'long-text', label: '长原因' },
];
export function CapabilityNoticeDemo({ scenario }: ReviewDemoProps) {
  const [message, log] = useDemoLog(scenario);
  const reasons: Record<Exclude<ActionAvailability['kind'], 'available'>, string> = {
    unsupportedHost: '当前环境没有设备连接入口，可以继续查看标签预览。',
    missingContract: '此连接尚未提供执行该动作的接口。',
    forbidden: '当前身份没有执行此动作的权限。',
    readOnly: '当前连接仅允许读取记录。',
    offline: '恢复网络连接后再核对能力。',
    missingFacts: '还需要明确物品身份和当前位置。',
    blockedState: '先处理待确认的原任务。',
  };
  const kind =
    scenario === 'long-text' ? 'unsupportedHost' : (scenario as ActionAvailability['kind']);
  const availability: ActionAvailability =
    kind === 'available'
      ? available
      : { kind, reason: scenario === 'long-text' ? longText : reasons[kind] };
  return (
    <div className="vn-stack">
      <PreviewNote />
      <CapabilityNotice
        capabilityLabel="设备打印"
        availability={availability}
        nextStep={{
          label: '查看可行下一步',
          onRequest: () => log(`已收到查看 ${kind} 恢复说明意图。未执行不可用动作。`),
        }}
      />
      <DemoLog>{message}</DemoLog>
    </div>
  );
}

const barcodeText = '6901234567892';
// This is the existing /i/<compact UUID> label format, represented as a static fixture.
const itemCodeText = 'https://example.test/i/ERERERERQRGBEQAAAAAAAQ';
const scanCandidates: readonly ScanCandidate[] = [
  { id: itemA, name: '透明收纳盒', locationLabel: '厨房 / 北侧高柜' },
  { id: itemB, name: '透明收纳盒', locationLabel: '餐厅 / 餐具柜' },
];
function scanFixture(scenario: string, sourceText: string): ScanResult {
  const candidates =
    scenario === 'long-text'
      ? scanCandidates.map((candidate) => ({ ...candidate, name: longText }))
      : scanCandidates;
  if (scenario === 'loading') return { kind: 'loading' };
  if (scenario === 'unknown' || scenario === 'forbidden' || scenario === 'error')
    return {
      kind: scenario,
      sourceText,
      reason:
        scenario === 'forbidden'
          ? '无权读取编码对应的记录，未展示候选身份。'
          : scenario === 'error'
            ? '本次读取未完成，请重新识别。'
            : '此演示编码没有可确认的物品匹配。',
    };
  if (scenario === 'ItemQR') return { kind: 'ItemQR', sourceText, item: scanCandidates[0]! };
  if (scenario === 'ambiguous')
    return {
      kind: 'ambiguous',
      sourceText,
      candidates,
      reason: '当前匹配到多件物品，需要明确选择完整身份。',
    };
  if (scenario === 'manual' || scenario === 'disabled') return { kind: 'idle' };
  return {
    kind: 'barcode',
    sourceText,
    barcode: barcodeText,
    candidates: scenario === 'empty' ? [] : candidates,
    hasMore: false,
  };
}
export const scanScenarios: readonly ReviewScenario[] = [
  { id: 'manual', label: '手动输入' },
  { id: 'ItemQR', label: '物品二维码' },
  { id: 'barcode', label: '条码 / 多件候选' },
  { id: 'ambiguous', label: '歧义' },
  { id: 'unknown', label: '未知码' },
  { id: 'forbidden', label: '无权限' },
  { id: 'error', label: '读取错误' },
  { id: 'loading', label: '识别中' },
  { id: 'empty', label: '未返回候选' },
  { id: 'unsupportedHost', label: '宿主无相机' },
  { id: 'disabled', label: '禁用' },
  { id: 'long-text', label: '长候选信息' },
];
export function ScanInputDemo({ scenario }: ReviewDemoProps) {
  const [message, log] = useDemoLog(scenario);
  const initialText =
    scenario === 'ItemQR' ? itemCodeText : scenario === 'manual' ? '' : barcodeText;
  const [text, setText] = useState(initialText);
  const [result, setResult] = useState<ScanResult>(() => scanFixture(scenario, initialText));
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setText(initialText);
    setResult(scanFixture(scenario, initialText));
    setSelected(null);
  }, [scenario, initialText]);
  return (
    <div className="vn-stack">
      <PreviewNote>
        演示支持固定条码 {barcodeText}。输入其他内容时显示未知；不会打开相机或调用识别服务。
      </PreviewNote>
      <ScanInput
        rawText={text}
        onRawTextChange={setText}
        result={result}
        selectedItemId={selected}
        disabled={scenario === 'disabled'}
        onResolve={(raw) => {
          setSelected(null);
          setResult(
            raw === itemCodeText
              ? scanFixture('ItemQR', raw)
              : raw === barcodeText
                ? scanFixture('barcode', raw)
                : scanFixture('unknown', raw),
          );
          log('已按本地固定输入切换识别 fixture。');
        }}
        onSelectItem={(id) => {
          setSelected(id);
          log(`已明确选择完整物品 ID：${id}`);
        }}
        onContinue={(id) => log(`已收到使用明确物品意图：${id}`)}
        cameraAvailability={
          scenario === 'unsupportedHost'
            ? { kind: 'unsupportedHost', reason: '当前预览不支持相机，可以手动输入。' }
            : available
        }
        onRequestCamera={() => log('已收到相机入口意图；预览不会调用相机。')}
      />
      <DemoLog>{message}</DemoLog>
    </div>
  );
}

export const printScenarios: readonly ReviewScenario[] = [
  { id: 'not-sent', label: '预览 / 未发送' },
  { id: 'disconnected', label: '设备未连接' },
  { id: 'unsupportedHost', label: '环境不支持' },
  { id: 'sending', label: '正在发送' },
  { id: 'sent', label: '已发送 / 纸张未知' },
  { id: 'device-feedback', label: '设备反馈' },
  { id: 'paper-confirmed', label: '人工确认出纸' },
  { id: 'unknown', label: '结果未知 / 禁止重印' },
  { id: 'failed', label: '失败' },
  { id: 'empty', label: '没有选择' },
  { id: 'long-text', label: '长标签内容' },
];
export function LabelPrintPanelDemo({ scenario }: ReviewDemoProps) {
  const [message, log] = useDemoLog(scenario);
  const status: PrintPageStatus = [
    'sending',
    'sent',
    'device-feedback',
    'paper-confirmed',
    'unknown',
    'failed',
  ].includes(scenario)
    ? (scenario as PrintPageStatus)
    : 'not-sent';
  const makePages = (): PrintPagePresentation[] => [
    { pageId: 'label-page-a', itemId: itemA, status },
    { pageId: 'label-page-b', itemId: itemB, status: 'not-sent' },
  ];
  const [pages, setPages] = useState(makePages);
  const [connected, setConnected] = useState(scenario !== 'disconnected');
  useEffect(() => {
    setPages(makePages());
    setConnected(scenario !== 'disconnected');
  }, [scenario, status]);
  return (
    <div className="vn-stack">
      <PreviewNote>
        标签文字与逐页状态仅用于预览。没有连接打印机、没有发送数据，也没有真实设备确认。下方“载入”按钮只切换
        fixture。
      </PreviewNote>
      <LabelPrintPanel
        selectedItemIds={scenario === 'empty' ? [] : [itemA, itemB]}
        items={[
          {
            id: itemA,
            name: '透明收纳盒',
            labelText: scenario === 'long-text' ? longText : '厨房 / 北侧高柜 · 日期未记录',
          },
          { id: itemB, name: '餐具收纳盒', labelText: '餐厅 / 餐具柜 · 日期未记录' },
        ]}
        pages={scenario === 'empty' ? [] : pages}
        deviceCapability={
          scenario === 'unsupportedHost'
            ? { kind: 'unsupportedHost', reason: '此环境没有可用的设备连接入口，仍可查看预览。' }
            : available
        }
        connection={connected ? 'connected' : 'disconnected'}
        deviceLabel="演示设备资料（无真实连接）"
        onConnect={() => {
          setConnected(true);
          log('已载入连接就绪 fixture，未连接设备。');
        }}
        onPrintUnsent={(ids) => {
          setPages((previous) =>
            previous.map((page) =>
              ids.includes(page.pageId) ? { ...page, status: 'sending' } : page,
            ),
          );
          log(`已收到发送意图：${ids.join('、')}；仅切换为发送中 fixture。`);
        }}
        onStop={() => {
          setPages((previous) =>
            previous.map((page) =>
              page.status === 'sending' ? { ...page, status: 'unknown' } : page,
            ),
          );
          log('演示停止后续发送；已发送页保留未知状态。');
        }}
        onInspectPage={(id) => log(`已收到核对纸张意图：${id}。没有重印。`)}
        onConfirmPaper={(id) => {
          setPages((previous) =>
            previous.map((page) =>
              page.pageId === id ? { ...page, status: 'paper-confirmed' } : page,
            ),
          );
          log(`已载入人工确认纸张 fixture：${id}。本预览没有真实纸张。`);
        }}
      />
      <div className="vn-row">
        <Button
          variant="secondary"
          onClick={() => {
            setPages((previous) =>
              previous.map((page) =>
                page.status === 'sending' ? { ...page, status: 'device-feedback' } : page,
              ),
            );
            log('已载入设备反馈 fixture，尚未标记人工出纸确认。');
          }}
        >
          载入：设备反馈
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            setPages((previous) =>
              previous.map((page) =>
                page.pageId === 'label-page-a' ? { ...page, status: 'unknown' } : page,
              ),
            );
            log('已载入结果未知 fixture，后续发送已暂停。');
          }}
        >
          载入：结果未知
        </Button>
      </div>
      <DemoLog>{message}</DemoLog>
    </div>
  );
}

export const operationsEntries: ReviewEntry[] = [
  {
    id: 'approval-summary',
    name: '批准范围摘要',
    group: '操作恢复与能力',
    description: 'ApprovalSummary · 既有提案范围、版本与确认意图',
    component: ApprovalSummaryDemo,
    scenarios: approvalScenarios,
    storyId: 'rc1-operations--approval-summary',
  },
  {
    id: 'conflict-resolution',
    name: '版本冲突核对',
    group: '操作恢复与能力',
    description: 'ConflictResolution · 原值、当前值与输入的逐项对比',
    component: ConflictResolutionDemo,
    scenarios: conflictScenarios,
    storyId: 'rc1-operations--conflict-resolution',
  },
  {
    id: 'operation-receipt',
    name: '操作回执',
    group: '操作恢复与能力',
    description: 'OperationReceipt · WriteResultV2 回执与独立刷新状态',
    component: OperationReceiptDemo,
    scenarios: receiptScenarios,
    storyId: 'rc1-operations--operation-receipt',
  },
  {
    id: 'pending-operation-banner',
    name: '待确认任务',
    group: '操作恢复与能力',
    description: 'PendingOperationBanner · 恢复原请求与保留离开',
    component: PendingOperationBannerDemo,
    scenarios: pendingScenarios,
    storyId: 'rc1-operations--pending-operation-banner',
  },
  {
    id: 'offline-banner',
    name: '离线范围提示',
    group: '操作恢复与能力',
    description: 'OfflineBanner · 缓存覆盖、时间与读取边界',
    component: OfflineBannerDemo,
    scenarios: offlineScenarios,
    storyId: 'rc1-operations--offline-banner',
  },
  {
    id: 'draft-status',
    name: '草稿保存状态',
    group: '操作恢复与能力',
    description: 'DraftStatus · 可靠保存、仅内存与保存失败',
    component: DraftStatusDemo,
    scenarios: draftScenarios,
    storyId: 'rc1-operations--draft-status',
  },
  {
    id: 'operation-sheet',
    name: '操作任务面板',
    group: '操作恢复与能力',
    description: 'OperationSheet · 全状态呈现与统一离开守卫',
    component: OperationSheetDemo,
    scenarios: operationStateScenarios,
    storyId: 'rc1-operations--operation-sheet',
  },
  {
    id: 'capability-notice',
    name: '能力与限制说明',
    group: '操作恢复与能力',
    description: 'CapabilityNotice · 明确不可执行原因和下一步',
    component: CapabilityNoticeDemo,
    scenarios: capabilityScenarios,
    storyId: 'rc1-operations--capability-notice',
  },
  {
    id: 'scan-input',
    name: '扫码与手动输入',
    group: '操作恢复与能力',
    description: 'ScanInput · 外部识别结果与完整物品身份选择',
    component: ScanInputDemo,
    scenarios: scanScenarios,
    storyId: 'rc1-operations--scan-input',
  },
  {
    id: 'label-print-panel',
    name: '标签预览与打印状态',
    group: '操作恢复与能力',
    description: 'LabelPrintPanel · 逐页发送、设备反馈和纸张确认',
    component: LabelPrintPanelDemo,
    scenarios: printScenarios,
    storyId: 'rc1-operations--label-print-panel',
  },
];
