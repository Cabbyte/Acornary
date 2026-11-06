import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { InlineNotice } from '../components/ui/inline-notice';
import type { ActionAvailability } from './types';
import './operations.css';

/** Safe presentation from an existing authenticated review. Never pass the challenge. */
export interface ApprovalPresentation {
  proposalId: string;
  householdLabel: string;
  scope: 'THIS_OPERATION_ONLY' | 'LONG_TERM_RULE';
  policyRevision: number | null;
  expiresAtLabel: string | null;
  validity: 'valid' | 'expired' | 'unknown';
  status: 'awaiting' | 'approved';
  impact: readonly string[];
  summary: string;
}
export interface ApprovalSummaryProps {
  proposal: ApprovalPresentation;
  availability: ActionAvailability;
  busy?: boolean;
  onRequestReview: (proposalId: string) => void;
  onConfirm: (proposalId: string) => void;
  onRevise: (proposalId: string) => void;
}
export function ApprovalSummary({
  proposal,
  availability,
  busy = false,
  onRequestReview,
  onConfirm,
  onRevise,
}: ApprovalSummaryProps) {
  const unavailable = availability.kind !== 'available';
  const confirmable =
    proposal.validity === 'valid' &&
    proposal.status === 'awaiting' &&
    proposal.policyRevision !== null &&
    !unavailable;
  return (
    <section
      className="vn-operation-card vn-stack"
      aria-label="审批范围摘要"
      aria-busy={busy || undefined}
    >
      <div className="vn-operation-heading">
        <h3 className="vn-section-title">核对批准范围</h3>
        <Badge variant={proposal.status === 'approved' ? 'success' : 'warning'}>
          {proposal.status === 'approved' ? '已批准' : '待确认'}
        </Badge>
      </div>
      <p className="vn-operation-summary">{proposal.summary}</p>
      <dl className="vn-operation-facts">
        <div>
          <dt>家庭</dt>
          <dd>{proposal.householdLabel}</dd>
        </div>
        <div>
          <dt>影响范围</dt>
          <dd>{proposal.scope === 'LONG_TERM_RULE' ? '长期规则' : '仅本次操作'}</dd>
        </div>
        <div>
          <dt>规则版本</dt>
          <dd>{proposal.policyRevision ?? '未知，需重新核对'}</dd>
        </div>
        <div>
          <dt>确认有效期</dt>
          <dd>{proposal.expiresAtLabel ?? '服务端未提供明确时间'}</dd>
        </div>
        <div>
          <dt>提案 ID</dt>
          <dd>
            <code>{proposal.proposalId}</code>
          </dd>
        </div>
      </dl>
      {proposal.impact.length ? (
        <ul className="vn-operation-list">
          {proposal.impact.map((impact, index) => (
            <li key={`${index}-${impact}`}>{impact}</li>
          ))}
        </ul>
      ) : (
        <InlineNotice tone="warning" title="影响说明尚未提供">
          请重新核对后再确认。
        </InlineNotice>
      )}
      {proposal.validity !== 'valid' && (
        <InlineNotice
          tone="warning"
          title={proposal.validity === 'expired' ? '本次确认已过期' : '确认有效性未知'}
        >
          需要在当前会话重新查看提案，不能直接继续确认。
        </InlineNotice>
      )}
      {unavailable && (
        <InlineNotice tone="warning" title="当前无法确认">
          {availability.reason}
        </InlineNotice>
      )}
      {proposal.status === 'approved' && (
        <InlineNotice tone="info" title="此范围已批准">
          后续业务操作是否完成，请查看对应的操作回执。
        </InlineNotice>
      )}
      <div className="vn-operation-actions">
        <Button
          variant="secondary"
          disabled={busy || unavailable}
          onClick={() => onRequestReview(proposal.proposalId)}
        >
          重新核对
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => onRevise(proposal.proposalId)}>
          返回修改
        </Button>
        <Button
          disabled={!confirmable || !proposal.impact.length}
          busy={busy}
          onClick={() => onConfirm(proposal.proposalId)}
        >
          确认此范围
        </Button>
      </div>
    </section>
  );
}
