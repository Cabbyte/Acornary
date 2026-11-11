import { useEffect, useState } from 'react';
import { Button } from '../../src/ui/components/ui/button';
import { Input } from '../../src/ui/components/ui/input';
import { FormField } from '../../src/ui/components/ui/form-field';
import { InlineNotice } from '../../src/ui/components/ui/inline-notice';
import { OperationSheet } from '../../src/ui/patterns/operation-sheet';
import { ApprovalSummary } from '../../src/ui/patterns/approval-summary';
import { ConflictResolution } from '../../src/ui/patterns/conflict-resolution';
import { OperationReceipt } from '../../src/ui/patterns/operation-receipt';
import { PendingOperationBanner } from '../../src/ui/patterns/pending-operation-banner';
import { OfflineBanner } from '../../src/ui/patterns/offline-banner';
import { PageHeader } from '../../src/ui/patterns/page-header';
import type { OperationState } from '../../src/ui/patterns/types';
import type { WriteResultV2 } from '../../../../packages/contracts/src/read-v2';
import type { ReviewDemoProps } from '../types';
import { ReviewNote } from '../review-frame';
import { items } from '../fixtures';
const taskId = 'preview-operation-stable-01';
const receipt: WriteResultV2 = {
  operation_id: 'operation_00000000-0000-4000-8000-000000000001',
  changed: true,
  affected_objects: [{ kind: 'ITEM', id: items[0].id, before_revision: 7, after_revision: 8 }],
  event_ids: ['event_00000000-0000-4000-8000-000000000001'],
  summary: '示例回执：本件物品的记录发生变化。',
};
export function OperationComposition({ scenario }: ReviewDemoProps) {
  const [state, setState] = useState<OperationState>(scenario as OperationState);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('放在冰箱中层');
  const [retained, setRetained] = useState(false);
  const [message, setMessage] = useState('');
  const [choices, setChoices] = useState<Record<string, 'current' | 'input' | undefined>>({});
  useEffect(() => {
    setState(scenario as OperationState);
    setOpen(false);
    setMessage('');
    setRetained(false);
    setChoices({});
  }, [scenario]);
  useEffect(() => {
    if (!open || (state !== 'submitting' && state !== 'validating')) return;
    const timer = setTimeout(() => {
      setState('networkUnknown');
      setMessage('预览计时已结束，现展示结果不确定状态。未发送请求。');
    }, 5000);
    return () => clearTimeout(timer);
  }, [open, state]);
  const feedback = (text: string) => setMessage(`${text}（隔离预览，未发送请求）`);
  return (
    <div className="vn-stack review-composition">
      <PageHeader title="操作与恢复" />
      <ReviewNote>当前状态：{state}。提交或校验中会锁定关闭5秒，再切换至结果未知。</ReviewNote>
      <Button onClick={() => setOpen(true)}>打开操作面板</Button>
      {(retained || state === 'networkUnknown') && (
        <PendingOperationBanner
          taskId={taskId}
          title="物品资料修改"
          scopeLabel="示例家庭 · 燕麦饮"
          state={retained ? 'retained' : 'networkUnknown'}
          originalAttemptAvailable
          recoveryAvailability={{ kind: 'available' }}
          onInspectOriginal={() => {
            setOpen(true);
            feedback('已打开原任务，任务引用不变');
          }}
          onRetryOriginal={() => feedback('已记录原请求恢复意图，未生成新请求')}
          onRetainAndLeave={() => {
            setRetained(true);
            setOpen(false);
            feedback('任务已在本次预览中保留');
          }}
        />
      )}
      {message && (
        <InlineNotice tone="info" title="预览反馈">
          {message}
        </InlineNotice>
      )}
      <OperationSheet
        open={open}
        recoveryContent={
          state === 'offline' ? (
            <OfflineBanner
              online={false}
              scopeLabel="示例家庭"
              coverage="cached-subset"
              cachedAtLabel="2026-11-06 14:32（亚洲/上海）"
              asOfChangeId="change_00000000-0000-4000-8000-000000000001"
              onReconnect={() => feedback('请求重新连接')}
            />
          ) : undefined
        }
        operation={{
          taskId,
          state,
          title: '核对这一件物品',
          description: '仅修改当前物品的记录，不改变同款商品资料。',
          scopeLabel: '示例家庭 · 燕麦饮',
          closePolicy: state === 'networkUnknown' ? 'retain' : 'allow',
        }}
        onAction={(id) => feedback(`收到 ${id} 意图`)}
        onClose={() => setOpen(false)}
        onRetainAndClose={() => {
          setRetained(true);
          setOpen(false);
        }}
        onCloseBlocked={feedback}
        onBack={() => feedback('返回草稿')}
        steps={[
          { id: 'draft', label: '填写', state: 'complete' },
          { id: 'review', label: '核对', state: 'current' },
          { id: 'result', label: '结果', state: 'pending' },
        ]}
        actions={
          state === 'networkUnknown'
            ? [{ id: 'restore-original', label: '核对原请求', kind: 'retry-original' }]
            : state === 'draft' || state === 'validationError'
              ? [{ id: 'confirm', label: '确认草稿', kind: 'submit' }]
              : []
        }
      >
        {state === 'approvalRequired' ? (
          <ApprovalSummary
            proposal={{
              proposalId: 'proposal_00000000-0000-4000-8000-000000000001',
              householdLabel: '示例家庭',
              scope: 'THIS_OPERATION_ONLY',
              policyRevision: 3,
              expiresAtLabel: null,
              validity: 'valid',
              status: 'awaiting',
              impact: ['仅影响这一件物品。', '不会改写商品共有资料。'],
              summary: '核对本次操作范围。',
            }}
            availability={{ kind: 'available' }}
            onRequestReview={() => feedback('重新核对审批资料')}
            onConfirm={() => feedback('请求确认批准范围；未生成批准结果')}
            onRevise={() => setState('draft')}
          />
        ) : state === 'revisionConflict' ? (
          <ConflictResolution
            objectId={items[0].id}
            scopeLabel="这一件物品的笔记"
            originalRevision={7}
            currentRevision={8}
            fields={[
              {
                key: 'note',
                label: '说明',
                original: { kind: 'known', text: '放在冰箱' },
                current: { kind: 'known', text: '放在冰箱上层' },
                input: { kind: 'known', text: note },
              },
            ]}
            choices={choices}
            availability={{ kind: 'available' }}
            onChoose={(key, value) => setChoices({ ...choices, [key]: value })}
            onRefresh={() => feedback('重新读取当前记录')}
            onReconfirm={() => feedback('已记录核对选择，草稿原文仍保留')}
          />
        ) : state === 'success' ? (
          <OperationReceipt
            result={receipt}
            objectLabels={{ [items[0].id]: items[0].name }}
            replay={false}
            refreshState="fresh"
            onOpenAffected={(id) => feedback(`查看 ${id}`)}
            onRefreshReads={() => feedback('只刷新读取结果')}
            onDone={() => setOpen(false)}
          />
        ) : (
          <FormField
            label="物品说明"
            error={state === 'validationError' ? '请确认说明与这一件物品相符。' : undefined}
          >
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              readOnly={state === 'networkUnknown'}
            />
          </FormField>
        )}
        {message && (
          <p className="vn-muted" role="status">
            {message}
          </p>
        )}
      </OperationSheet>
    </div>
  );
}
