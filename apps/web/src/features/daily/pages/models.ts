import type { HistoryEntryProps } from '../../../ui/patterns/history-entry';
import type {
  DateFactPresentation,
  GroupView,
  ItemView,
  NoteView,
  QuantityPresentation,
} from '../../../ui/patterns/types';
import type { PaginationControlsProps } from '../../../ui/components/ui/pagination-controls';

/** Read coverage is supplied by the application adapter, never inferred from an empty array. */
export type DailyReadState =
  | 'ready'
  | 'loading'
  | 'error'
  | 'forbidden'
  | 'offline-partial'
  | 'offline-empty'
  | 'session-changed'
  | 'not-found';
export interface DailyItemFacts {
  item: ItemView;
  quantity: QuantityPresentation;
  date?: DateFactPresentation;
}
export interface DailyProductFacts {
  group: GroupView;
  subtitle: string;
  catalogPath: readonly string[];
  date?: DateFactPresentation;
}
export type DailyPagination = Omit<PaginationControlsProps, 'className' | 'loading' | 'disabled'>;
export interface DailyReadProps {
  state: DailyReadState;
  onRetry: () => void;
}
export interface DailyBrowseProps extends DailyReadProps {
  query: string;
  queryDraft: string;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  view: 'items' | 'products';
  onViewChange: (view: 'items' | 'products') => void;
  items: readonly DailyItemFacts[];
  products: readonly DailyProductFacts[];
  pagination: DailyPagination;
  locationId: string | null;
  locations: readonly { id: string; label: string }[];
  onLocationChange: (id: string | null) => void;
  onResetQuery: () => void;
  onOpenItem: (id: string) => void;
  onOpenProduct: (id: string) => void;
  onBack?: () => void;
}
export interface DailyProductProps extends DailyReadProps {
  product: DailyProductFacts | null;
  items: readonly DailyItemFacts[];
  pagination: DailyPagination;
  onOpenItem: (id: string) => void;
  onBack: () => void;
}
export interface DailyItemProps extends DailyReadProps {
  facts: DailyItemFacts | null;
  product: DailyProductFacts | null;
  notes: readonly NoteView[];
  history: readonly Omit<HistoryEntryProps, 'expanded' | 'onExpandedChange'>[];
  tab: 'overview' | 'notes' | 'history';
  onTabChange: (tab: 'overview' | 'notes' | 'history') => void;
  onOpenProduct: (id: string) => void;
  onBack: () => void;
}
