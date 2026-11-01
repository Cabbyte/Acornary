import { useState, type ReactNode } from 'react';
import styles from './Section.module.css';

export interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Native details/summary disclosure; the action stays clickable outside the summary. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}

function Chevron() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path
        d="m7.5 5 5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A titled content section. Sections are not cards; they sit on the content surface. */
export function Section({
  title,
  description,
  action,
  collapsible = false,
  defaultOpen = true,
  children,
  className,
  id,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section id={id} className={[styles.section, className].filter(Boolean).join(' ')}>
      {collapsible ? (
        <>
          <details
            className={styles.details}
            open={open}
            onToggle={(event) => setOpen(event.currentTarget.open)}
          >
            <summary className={styles.summary}>
              <span className={styles.chevron} aria-hidden="true">
                <Chevron />
              </span>
              <span className={styles.heading}>
                <h2 className={styles.title}>{title}</h2>
                {description && <p className={styles.description}>{description}</p>}
              </span>
            </summary>
            <div className={styles.content}>{children}</div>
          </details>
          {action && <div className={styles.actionFloat}>{action}</div>}
        </>
      ) : (
        <>
          <div className={styles.header}>
            <div className={styles.heading}>
              <h2 className={styles.title}>{title}</h2>
              {description && <p className={styles.description}>{description}</p>}
            </div>
            {action && <div className={styles.action}>{action}</div>}
          </div>
          <div className={styles.content}>{children}</div>
        </>
      )}
    </section>
  );
}
