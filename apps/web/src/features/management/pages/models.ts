import type {
  AttributeBindingV2,
  TemplateDefinitionV2,
} from '../../../../../../packages/contracts/src/read-v2';
import type {
  ItemView,
  CatalogView,
  LocationView,
  ActionAvailability,
  SelectionSnapshot,
} from '../../../ui/patterns/types';
import type { TreeViewNode } from '../../../ui/components/ui/tree-view';
import type { DataTableSorting } from '../../../ui/components/ui/data-table';
import type { HistoryEntryProps } from '../../../ui/patterns/history-entry';
import type { ConflictResolutionProps } from '../../../ui/patterns/conflict-resolution';
import type { ApprovalPresentation } from '../../../ui/patterns/approval-summary';
import type { AttributeFieldEdit } from '../../../ui/patterns/attribute-fields';

export type ManagementState =
  'ready' | 'loading' | 'error' | 'offline' | 'forbidden' | 'session-changed';
export interface ManagedCatalog extends CatalogView {
  path: string[];
  itemCount: number | null;
  hidden: boolean;
  specification: string;
}
export interface ManagedLocation extends LocationView {
  path: string[];
  revision: number;
  canContain: boolean;
  recordState: 'VALID' | 'VOID';
  contentCount: number | null;
  containerCatalogId: string | null;
}
export interface FieldDraft {
  mode: 'unchanged' | 'set' | 'clear';
  value: string;
}
export interface ManagementField {
  key: string;
  label: string;
  value: string;
  required?: boolean;
  type?: 'text' | 'date' | 'number';
  options?: readonly { value: string; label: string; disabled?: boolean; description?: string }[];
  hint?: string;
}
export interface ManagementTask {
  kind: string;
  title: string;
  description: string;
  targetIds: readonly string[];
  fields: readonly ManagementField[];
  impact: readonly { label: string; before: string; after: string }[];
  blockedReason?: string;
  error?: string;
  phase: 'draft' | 'review' | 'submitting' | 'unknown' | 'receipt';
  taskId?: string;
  returnPath?: string;
  scopeGeneration?: number;
  draft?: {
    name: FieldDraft;
    binding: AttributeBindingV2 | null;
    changedAttributes: readonly string[];
  };
  approval?: ApprovalPresentation;
  receipt?: string;
  confirmLabel: string;
  snapshot: readonly { id: string; name: string; path: string; revision: number }[];
}
export interface ManagementExport {
  scope: string;
  generatedAt: string;
  total: number;
  loaded: number;
  complete: boolean;
  href?: string;
}
export interface ManagementModel {
  state: ManagementState;
  writeAvailability: ActionAvailability;
  feedback: string;
  items: readonly ItemView[];
  allItems: readonly ItemView[];
  query: string;
  sorting: DataTableSorting;
  page: number;
  total: number;
  pageSize: number;
  locationFilter: string | null;
  categoryFilter: string | null;
  includeVoid: boolean;
  includeHidden: boolean;
  includeOneOff: boolean;
  showDetails: boolean;
  selection: SelectionSnapshot;
  selectionExpanded: boolean;
  expandedRows: readonly string[];
  catalogs: readonly ManagedCatalog[];
  catalogTree: readonly TreeViewNode[];
  selectedCatalog: ManagedCatalog | null;
  catalogExpanded: readonly string[];
  locations: readonly ManagedLocation[];
  locationTree: readonly TreeViewNode[];
  selectedLocation: ManagedLocation | null;
  locationExpanded: readonly string[];
  treeOpen: boolean;
  item: ItemView | null;
  itemCatalog: ManagedCatalog | null;
  nameDraft: FieldDraft;
  lifecycle: AttributeBindingV2 | null;
  lifecycleTemplate: TemplateDefinitionV2 | null;
  changedAttributes: readonly string[];
  unknownBinding: AttributeBindingV2 | null;
  task: ManagementTask | null;
  export: ManagementExport | null;
  history: readonly (Omit<HistoryEntryProps, 'expanded' | 'onExpandedChange'> & {
    operationComplete: boolean;
  })[];
  historyExpanded: readonly string[];
  historyEvent: string;
  historyOperation: string;
  historyTarget: string;
  historyFrom: string;
  historyTo: string;
  conflict: Omit<ConflictResolutionProps, 'onChoose' | 'onRefresh' | 'onReconfirm'> | null;
}
export interface ManagementProps {
  model: ManagementModel;
  onChange: (key: string, value: unknown) => void;
  onIntent: (kind: string, id?: string) => void;
  onNavigate: (path: string) => void;
  onAttributeChange: (edit: AttributeFieldEdit) => void;
}
