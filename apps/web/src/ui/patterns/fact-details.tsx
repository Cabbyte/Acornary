import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../components/utils';
import './facts.css';

/** Native disclosure keeps secondary facts reachable by touch and keyboard. */
export function FactDetails({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn('vn-fact-details', className)}>
      <summary>
        <span>{label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="vn-fact-details-content">{children}</div>
    </details>
  );
}
