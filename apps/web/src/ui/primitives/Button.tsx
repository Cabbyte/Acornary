import { Button as AntButton } from 'antd';
import type { MouseEventHandler, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps {
  children?: ReactNode;
  /** Visual role. `type` below is the native button type, never Ant's visual `type`. */
  variant?: ButtonVariant;
  /** md is 36px on desktop and 44px on phones; sm is 28px. */
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  block?: boolean;
  icon?: ReactNode;
  title?: string;
  className?: string;
  id?: string;
  name?: string;
  /** Native button behavior, forwarded to Ant's `htmlType` when `htmlType` is omitted. */
  type?: 'button' | 'submit' | 'reset';
  htmlType?: 'button' | 'submit' | 'reset';
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  'aria-haspopup'?: 'menu' | 'dialog' | 'listbox' | 'true';
  onClick?: MouseEventHandler<HTMLElement>;
  autoFocus?: boolean;
}

const antType: Record<ButtonVariant, 'primary' | 'default' | 'text'> = {
  primary: 'primary',
  secondary: 'default',
  quiet: 'text',
  danger: 'primary',
};

/**
 * Ant Design owns the button behavior (loading, disabled, keyboard activation);
 * Acornary owns the visual variants through tokens and CSS Modules.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  block,
  icon,
  className,
  type = 'button',
  htmlType,
  ...rest
}: ButtonProps) {
  return (
    <AntButton
      {...rest}
      type={antType[variant]}
      danger={variant === 'danger'}
      htmlType={htmlType ?? type}
      loading={loading}
      disabled={disabled}
      block={block}
      icon={icon}
      className={[styles.button, styles[size], className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
    >
      {children}
    </AntButton>
  );
}
