import { Separator as BaseSeparator } from '@base-ui/react/separator';
import { cn } from '../utils';
import '../../patterns/facts.css';

// https://ui.shadcn.com/docs/components/base/separator
// https://base-ui.com/react/components/separator
export interface SeparatorProps extends BaseSeparator.Props {
  /** Hide purely visual separators from assistive technology. */
  decorative?: boolean;
}

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = false,
  ...props
}: SeparatorProps) {
  return (
    <BaseSeparator
      {...props}
      orientation={orientation}
      aria-hidden={decorative || undefined}
      className={(state) =>
        cn('vn-separator', typeof className === 'function' ? className(state) : className)
      }
    />
  );
}
