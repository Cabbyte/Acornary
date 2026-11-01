import type { MouseEventHandler, ReactNode } from 'react';
import styles from './IconButton.module.css';

export interface IconButtonProps {
  /** Required accessible name. */
  label: string;
  /** Optional native tooltip text (`title` attribute). */
  title?: string;
  icon: ReactNode;
  variant?: 'quiet' | 'secondary';
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  id?: string;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  'aria-haspopup'?: 'menu' | 'dialog' | 'listbox' | 'true';
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

/**
 * A square, label-only control for row overflow menus and icon actions.
 * Plain HTML + CSS so it does not depend on Ant's button internals.
 */
export function IconButton({
  label,
  title,
  icon,
  variant = 'quiet',
  disabled,
  type = 'button',
  className,
  id,
  onClick,
  ...aria
}: IconButtonProps) {
  return (
    <button
      {...aria}
      id={id}
      type={type}
      className={[styles.iconButton, className].filter(Boolean).join(' ')}
      data-variant={variant}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}
