import { Button, type ButtonProps } from './button';
import { cn } from '../utils';

export interface IconButtonProps extends Omit<ButtonProps, 'aria-label'> {
  label: string;
}

/** The required label is the accessible action name, never an icon filename. */
export function IconButton({
  label,
  className,
  children,
  variant = 'quiet',
  busy,
  ...props
}: IconButtonProps) {
  return (
    <Button
      {...props}
      variant={variant}
      busy={busy}
      aria-label={label}
      title={label}
      className={cn('vn-icon-button', className)}
    >
      {!busy && (
        <span className="vn-icon-button__glyph" aria-hidden="true">
          {children}
        </span>
      )}
    </Button>
  );
}
