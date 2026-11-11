import { PackageOpen, Package, CircleHelp, CirclePlay, ArchiveX } from 'lucide-react';
import type { ItemView, ActionAvailability, FactPresentation } from './types';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { LoadingState } from './loading-state';
import { cn } from '../components/utils';
import './lists.css';

export interface ItemStatusFact {
  kind: 'lifecycle' | 'opening' | 'custody' | 'service';
  label: string;
  value: string | null;
  tone?: ItemView['status']['tone'];
}
export interface ItemStatusProps {
  status: ItemView['status'] | null;
  recordState: ItemView['recordState'];
  facts?: readonly ItemStatusFact[];
  availability?: ActionAvailability;
  loading?: boolean;
  presentation?: FactPresentation;
  onExplain?: () => void;
  className?: string;
}

export function ItemStatus({
  status,
  recordState,
  facts = [],
  availability,
  loading = false,
  presentation = 'summary',
  onExplain,
  className,
}: ItemStatusProps) {
  const icon =
    status?.label === '已开封' ? (
      <PackageOpen />
    ) : status?.label === '未开封' ? (
      <Package />
    ) : status?.label === '使用中' ? (
      <CirclePlay />
    ) : !status || /未记录|未知/.test(status.label) ? (
      <CircleHelp />
    ) : undefined;
  if (loading) return <LoadingState layout="compact" label="正在加载状态" />;
  return (
    <div className={cn('vn-item-status', className)} data-presentation={presentation}>
      <div className="vn-row">
        <Badge variant={status?.tone ?? 'neutral'} icon={icon}>
          {status?.label || '状态未记录'}
        </Badge>
        {recordState === 'VOID' && (
          <Badge variant="neutral" icon={<ArchiveX />}>
            记录已作废
          </Badge>
        )}
      </div>
      {facts.length > 0 && (
        <dl className="vn-status-facts">
          {facts.map((fact) => (
            <div key={fact.kind}>
              <dt>{fact.label}</dt>
              <dd>
                <Badge variant={fact.tone ?? 'neutral'}>{fact.value ?? '未记录'}</Badge>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {availability && availability.kind !== 'available' && (
        <p className="vn-list-meta">{availability.reason}</p>
      )}
      {onExplain && (
        <Button variant="quiet" onClick={onExplain}>
          查看状态说明
        </Button>
      )}
    </div>
  );
}
