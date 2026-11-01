import type { ReactNode } from 'react';
import styles from './Metric.module.css';

export interface MetricProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}

/** A compact label/value/hint block. Values use tabular numerals. */
export function Metric({ label, value, hint, className }: MetricProps) {
  return (
    <div className={[styles.metric, className].filter(Boolean).join(' ')}>
      <span className={styles.label}>{label}</span>
      <span className={[styles.value, 'ac-num'].join(' ')}>{value}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
