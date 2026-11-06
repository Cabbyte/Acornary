import type { ReactNode } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { InlineNotice } from '../components/ui/inline-notice';
import { Sheet } from '../components/ui/sheet';
import type { OperationPresentation, OperationState } from './types';
import './operations.css';

export interface OperationSheetAction {
  id: string;
  label: string;
  kind: 'submit' | 'retry-original' | 'read' | 'other';
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  disabled?: boolean;
  disabledReason?: string;
}
export interface OperationSheetStep {
  id: string;
  label: string;
  state: 'pending' | 'current' | 'complete' | 'error';
}
export interface OperationSheetProps {
  open: boolean;
  operation: OperationPresentation;
  children?: ReactNode;
  steps?: readonly OperationSheetStep[];
  actions?: readonly OperationSheetAction[];
  onAction: (actionId: string, taskId: string) => void;
  onClose: (taskId: string) => void;
  /** Parent must retain the task before changing open; this component never drops it. */
  onRetainAndClose: (taskId: string) => void;
  onBack?: (taskId: string) => void;
  onCloseBlocked?: (reason: string) => void;
  onReestablishContext?: () => void;
}
const stateLabels: Record<OperationState, string> = {
  initial: '尚未开始',
  loading: '正在读取',
  empty: '没有可处理内容',
  draft: '编辑草稿',
  validating: '正在核对',
  approvalRequired: '需要批准',
  submitting: '正在保存',
  success: '已取得结果',
  validationError: '请检查输入',
  revisionConflict: '记录版本已变化',
  networkUnknown: '结果待确认',
  offline: '离线只读',
  forbidden: '当前不可执行',
  sessionChanged: '身份或家庭已变化',
};
export function OperationSheet({
  open,
  operation,
  children,
  steps,
  actions = [],
  onAction,
  onClose,
  onRetainAndClose,
  onBack,
  onCloseBlocked,
  onReestablishContext,
}: OperationSheetProps) {
  const busy = operation.state === 'submitting' || operation.state === 'validating';
  const blockedReason = busy
    ? '当前步骤正在进行，暂时不能关闭或返回。'
    : operation.closePolicy === 'blocked'
      ? '当前任务不允许关闭，请先处理面板中的阻断原因。'
      : undefined;
  const retain = operation.state === 'networkUnknown' || operation.closePolicy === 'retain';
  const contextInvalid = operation.state === 'sessionChanged' || operation.state === 'forbidden';
  const submitAllowed = operation.state === 'draft' || operation.state === 'validationError';
  const requestClose = () => {
    if (blockedReason) {
      onCloseBlocked?.(blockedReason);
      return;
    }
    if (retain) onRetainAndClose(operation.taskId);
    else onClose(operation.taskId);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
      title={contextInvalid ? stateLabels[operation.state] : operation.title}
      description={
        contextInvalid ? '请重新建立合法上下文，旧任务内容已隐藏。' : operation.description
      }
      busy={busy}
      closeBlockedReason={blockedReason}
      onCloseBlocked={onCloseBlocked}
      footer={
        <>
          {onBack && (
            <Button
              variant="quiet"
              disabled={!!blockedReason || retain || contextInvalid}
              onClick={() => onBack(operation.taskId)}
            >
              上一步
            </Button>
          )}
          <Button variant="secondary" disabled={!!blockedReason} onClick={requestClose}>
            {retain ? '保留任务并收起' : '关闭'}
          </Button>
          {contextInvalid && (
            <Button disabled={!onReestablishContext} onClick={onReestablishContext}>
              重新核对当前连接
            </Button>
          )}
          {!contextInvalid &&
            actions.map((action) => (
              <Button
                key={action.id}
                variant={action.variant || 'primary'}
                title={action.disabledReason}
                disabled={
                  busy ||
                  contextInvalid ||
                  action.disabled ||
                  !!action.disabledReason ||
                  (action.kind === 'submit' && !submitAllowed) ||
                  (action.kind === 'retry-original' && operation.state !== 'networkUnknown')
                }
                onClick={() => onAction(action.id, operation.taskId)}
              >
                {action.label}
              </Button>
            ))}
        </>
      }
    >
      <div className="vn-operation-heading">
        <Badge
          variant={operation.state === 'success' ? 'success' : contextInvalid ? 'danger' : 'info'}
        >
          {stateLabels[operation.state]}
        </Badge>
        {!contextInvalid && operation.scopeLabel && (
          <span className="vn-muted">{operation.scopeLabel}</span>
        )}
      </div>
      {!contextInvalid && (
        <p className="vn-operation-reference">
          任务引用：<code>{operation.taskId}</code>
        </p>
      )}
      {operation.state === 'networkUnknown' && (
        <InlineNotice tone="warning" title="可能已经保存，请核对原请求">
          收起会保留恢复入口，不会取消已经发送的请求。
        </InlineNotice>
      )}
      {operation.state === 'offline' && (
        <InlineNotice tone="warning" title="离线期间不能发送">
          可以查看当前内容和保留草稿，恢复连接后重新核对。
        </InlineNotice>
      )}
      {contextInvalid ? (
        <InlineNotice tone="danger" title="旧任务不可继续提交">
          不会在新的身份或家庭下重放原请求。
        </InlineNotice>
      ) : (
        <>
          {steps && (
            <ol className="vn-operation-steps" aria-label="任务步骤">
              {steps.map((step) => (
                <li
                  key={step.id}
                  data-state={step.state}
                  aria-current={step.state === 'current' ? 'step' : undefined}
                >
                  <span>{step.label}</span>
                  <span className="vn-muted">
                    {step.state === 'complete'
                      ? '已完成'
                      : step.state === 'current'
                        ? '当前步骤'
                        : step.state === 'error'
                          ? '需要检查'
                          : '待进行'}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <fieldset
            className="vn-operation-fields"
            disabled={busy || operation.state === 'networkUnknown' || operation.state === 'offline'}
          >
            {children}
          </fieldset>
        </>
      )}
      {!contextInvalid && actions.some((action) => action.disabledReason) && (
        <ul className="vn-operation-list">
          {actions
            .filter((action) => action.disabledReason)
            .map((action) => (
              <li key={action.id}>
                {action.label}：{action.disabledReason}
              </li>
            ))}
        </ul>
      )}
    </Sheet>
  );
}
