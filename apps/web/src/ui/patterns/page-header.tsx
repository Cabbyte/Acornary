import { useId, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '../components/ui/icon-button';
import { Button } from '../components/ui/button';
import { cn } from '../components/utils';
import type { ActionAvailability } from './types';
import './lists.css';

export interface PageHeaderAction {
  id: string;
  label: string;
  availability: ActionAvailability;
  onAction: () => void;
  busy?: boolean;
}
export interface PageHeaderProps {
  title: string;
  context?: ReactNode;
  headingLevel?: 1 | 2;
  backLabel?: string;
  onBack?: () => void;
  primaryAction?: PageHeaderAction;
  secondaryActions?: readonly PageHeaderAction[];
  className?: string;
}

export function PageHeader({
  title,
  context,
  headingLevel = 1,
  backLabel = '返回',
  onBack,
  primaryAction,
  secondaryActions = [],
  className,
}: PageHeaderProps) {
  const id = useId();
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <header className={cn('vn-page-header', className)} aria-labelledby={id}>
      <div className="vn-page-header-title">
        {onBack && (
          <IconButton label={backLabel} className="vn-page-back" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" />
          </IconButton>
        )}
        <div>
          <Heading id={id}>{title}</Heading>
          {context && <div className="vn-list-meta">{context}</div>}
        </div>
      </div>
      {(primaryAction || secondaryActions.length > 0) && (
        <div className="vn-page-header-actions">
          {secondaryActions.map((action) => (
            <div key={action.id} className="vn-list-action">
              <Button
                variant="secondary"
                busy={action.busy}
                disabled={action.availability.kind !== 'available'}
                onClick={action.onAction}
              >
                {action.label}
              </Button>
              {action.availability.kind !== 'available' && (
                <span className="vn-list-meta">{action.availability.reason}</span>
              )}
            </div>
          ))}
          {primaryAction && (
            <div className="vn-list-action">
              <Button
                busy={primaryAction.busy}
                disabled={primaryAction.availability.kind !== 'available'}
                onClick={primaryAction.onAction}
              >
                {primaryAction.label}
              </Button>
              {primaryAction.availability.kind !== 'available' && (
                <span className="vn-list-meta">{primaryAction.availability.reason}</span>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
