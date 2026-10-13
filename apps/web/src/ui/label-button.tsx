import { Button } from 'antd';
import { canPrintLabels } from '../lib/labels';
import { embeddedRuntime } from '../lib/runtime';
export function LabelButton({
  onClick,
  disabled,
  children = '打印标签',
}: {
  onClick: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  if (embeddedRuntime() || !canPrintLabels()) return null;
  return (
    <Button disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}
