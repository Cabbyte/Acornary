import { ItemRow, type ItemRowProps } from './item-row';
import { cn } from '../components/utils';
import './lists.css';

export type ItemCardProps = ItemRowProps;

/** Shares the same identity, facts, and intent contract as ItemRow. */
export function ItemCard({ className, ...props }: ItemCardProps) {
  return <ItemRow {...props} className={cn('vn-item-card', className)} />;
}
