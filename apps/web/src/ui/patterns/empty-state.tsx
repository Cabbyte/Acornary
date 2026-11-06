import { useId, type ReactNode } from 'react';
import { CircleHelp, Inbox, Search, ShieldAlert, Unplug, WifiOff } from 'lucide-react';
import { cn } from '../components/utils';
import '../components/ui/overlays.css';

// Presentation composition informed by https://ui.shadcn.com/docs/components/base/empty.
// Product reasons stay explicit: failed or forbidden reads are never empty inventory.
export type EmptyStateReason =
  'empty' | 'no-match' | 'permission' | 'error' | 'unknown' | 'offline';
export interface EmptyStateProps {
  reason: EmptyStateReason;
  title?: ReactNode;
  context?: ReactNode;
  recoveryAction?: ReactNode;
  className?: string;
}
const states = {
  empty: { title: '当前范围暂无记录', detail: '', icon: Inbox },
  'no-match': { title: '没有找到匹配项', detail: '可以调整关键词或筛选条件。', icon: Search },
  permission: {
    title: '无法查看此范围',
    detail: '当前权限不允许读取这些记录，数量未知。',
    icon: ShieldAlert,
  },
  error: { title: '暂时无法读取记录', detail: '读取未完成，库存数量未知。', icon: Unplug },
  unknown: { title: '当前记录情况未知', detail: '尚未取得可用的读取结果。', icon: CircleHelp },
  offline: {
    title: '连接已断开',
    detail: '当前没有可展示的缓存，恢复连接后才能读取。',
    icon: WifiOff,
  },
} as const;
export function EmptyState({ reason, title, context, recoveryAction, className }: EmptyStateProps) {
  const headingId = useId();
  const presentation = states[reason];
  const Icon = presentation.icon;
  return (
    <section
      className={cn('vn-empty-state', className)}
      data-reason={reason}
      aria-labelledby={headingId}
    >
      <span className="vn-state-icon">
        <Icon size={24} aria-hidden="true" />
      </span>
      <h3 className="vn-state-title" id={headingId}>
        {title || presentation.title}
      </h3>
      {(context || presentation.detail) && (
        <div className="vn-state-context">{context || presentation.detail}</div>
      )}
      {recoveryAction && <div className="vn-state-actions">{recoveryAction}</div>}
    </section>
  );
}
