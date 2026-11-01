import type { ComponentProps } from 'react';
import { Button as AntButton } from 'antd';
import { Button } from '../../ui/primitives';

/** Keeps controller actions identical while translating their visual role to Quiet Ledger. */
export function WriteButton({
  type,
  danger,
  children,
  onClick,
  htmlType,
  disabled,
  loading,
}: ComponentProps<typeof AntButton>) {
  return (
    <Button
      variant={danger ? 'danger' : type === 'primary' ? 'primary' : 'secondary'}
      htmlType={htmlType}
      disabled={disabled}
      loading={!!loading}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
