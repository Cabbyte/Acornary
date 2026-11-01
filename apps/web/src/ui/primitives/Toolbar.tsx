import type { ReactNode } from 'react';
import styles from './Toolbar.module.css';

export interface ToolbarProps {
  /** Search input/control. It becomes a full row when the container is under 720px. */
  search?: ReactNode;
  /** Filter/sort/view controls, or other inline tools. */
  children?: ReactNode;
  /** Primary and secondary toolbar actions, aligned to the end. */
  actions?: ReactNode;
  className?: string;
  'aria-label'?: string;
}

/**
 * Responsive toolbar. Uses a container query (not the viewport) so it also
 * adapts inside MCP iframes and the detail panel.
 */
export function Toolbar({ search, children, actions, className, ...rest }: ToolbarProps) {
  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <div className={styles.toolbar} role="group" {...rest}>
        {search && <div className={styles.search}>{search}</div>}
        {children && <div className={styles.children}>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}
