import type { ReactNode } from 'react';
import styles from './StatusTag.module.css';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface StatusTagProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

/**
 * A status label that never relies on color alone: the dot is decorative and
 * the visible text always carries the meaning.
 */
export function StatusTag({ tone = 'neutral', children, className }: StatusTagProps) {
  return (
    <span className={[styles.tag, className].filter(Boolean).join(' ')} data-tone={tone}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>{children}</span>
    </span>
  );
}
