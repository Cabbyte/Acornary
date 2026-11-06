import { Button } from '../components/ui/button';
import { InlineNotice } from '../components/ui/inline-notice';
import type { ActionAvailability } from './types';
import './operations.css';

export interface CapabilityNoticeProps {
  capabilityLabel: string;
  availability: ActionAvailability;
  nextStep?: { label: string; onRequest: () => void; disabled?: boolean };
}
const reasonLabels = {
  readOnly: '当前连接为只读',
  offline: '当前离线',
  missingFacts: '所需信息不完整',
  unsupportedHost: '当前环境不支持',
  missingContract: '当前接口尚未提供',
  blockedState: '当前状态不可执行',
  forbidden: '当前权限不允许',
} as const;
export function CapabilityNotice({
  capabilityLabel,
  availability,
  nextStep,
}: CapabilityNoticeProps) {
  return (
    <InlineNotice
      tone={
        availability.kind === 'available'
          ? 'info'
          : availability.kind === 'forbidden'
            ? 'danger'
            : 'warning'
      }
      title={
        availability.kind === 'available'
          ? `${capabilityLabel}可用`
          : `${capabilityLabel}：${reasonLabels[availability.kind]}`
      }
      action={
        nextStep && (
          <Button variant="secondary" disabled={nextStep.disabled} onClick={nextStep.onRequest}>
            {nextStep.label}
          </Button>
        )
      }
    >
      {availability.kind === 'available'
        ? '仅表示当前入口具备能力；操作是否完成以实际反馈为准。'
        : availability.reason}
    </InlineNotice>
  );
}
