import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

export type PageHeaderBack =
  | { label: string; href: string; onClick?: never }
  | { label: string; onClick: () => void; href?: never };

export interface PageHeaderProps {
  back?: PageHeaderBack;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

function BackArrow() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M12.5 4.5 7 10l5.5 5.5M7 10h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Page heading with an optional back target, subtitle, and actions.
 * Always renders exactly one h1. Page actions are passed as a slot.
 */
export function PageHeader({ back, title, subtitle, actions, className }: PageHeaderProps) {
  const backContent = back && (
    <>
      <span className={styles.backIcon} aria-hidden="true">
        <BackArrow />
      </span>
      <span>{back.label}</span>
    </>
  );

  return (
    <header className={[styles.header, className].filter(Boolean).join(' ')}>
      <div className={styles.bar}>
        {back &&
          ('href' in back ? (
            <Link className={styles.back} to={back.href}>
              {backContent}
            </Link>
          ) : (
            <button className={styles.back} type="button" onClick={back.onClick}>
              {backContent}
            </button>
          ))}
        <div className={styles.copy}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  );
}
