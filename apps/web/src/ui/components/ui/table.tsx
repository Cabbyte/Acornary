import type { ComponentProps } from 'react';
import { cn } from '../utils';
import '../../patterns/facts.css';

// Native semantic composition follows https://ui.shadcn.com/docs/components/base/table.
// Sorting, selection, pagination, and row actions belong to the consuming controller.
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="vn-table-scroll">
      <table className={cn('vn-table', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('vn-table-header', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('vn-table-body', className)} {...props} />;
}

export function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return <tfoot className={cn('vn-table-footer', className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('vn-table-row', className)} {...props} />;
}

export function TableHead({ className, scope = 'col', ...props }: ComponentProps<'th'>) {
  return <th scope={scope} className={cn('vn-table-head', className)} {...props} />;
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('vn-table-cell', className)} {...props} />;
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption className={cn('vn-table-caption', className)} {...props} />;
}
