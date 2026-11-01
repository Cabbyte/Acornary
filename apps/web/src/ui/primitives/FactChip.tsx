import type { ReactNode } from 'react';
import styles from './FactChip.module.css';

export interface FactChipProps {
  children: ReactNode;
  className?: string;
}

/**
 * A small, read-only fact such as "1 L" or "开封 3 天". It is intentionally not
 * focusable and has no button behavior.
 */
export function FactChip({ children, className }: FactChipProps) {
  return (
    <span className={[styles.chip, className].filter(Boolean).join(' ')}>
      <span className={styles.text}>{children}</span>
    </span>
  );
}
