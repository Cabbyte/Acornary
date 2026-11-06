import type { DateFact } from '../../../../../packages/contracts/src/read-v2';
/** Presentation only; summary never changes the underlying fact or operation identity. */
export type FactPresentation = 'summary' | 'detail';
export type {
  ItemView,
  GroupView,
  CatalogView,
  LocationView,
  AttachmentView,
  NoteView,
  FactSourceView,
} from '../../features/inventory/model/types';
export type ActionAvailability =
  | { kind: 'available' }
  | {
      kind:
        | 'readOnly'
        | 'offline'
        | 'missingFacts'
        | 'unsupportedHost'
        | 'missingContract'
        | 'blockedState'
        | 'forbidden';
      reason: string;
    };
export interface QuantityPresentation {
  value: string | null;
  unit: string;
  accuracy: 'measured' | 'estimated' | 'unknown';
}
export interface DateFactPresentation {
  kind: DateFact['kind'];
  dateKind?: DateFact['date_kind'] | null;
  dueOn: string | null;
  basis: string | null;
  state: DateFact['state'];
  source?: DateFact['source'];
  label: string;
  completedOn?: string | null;
}
export interface SelectionSnapshot {
  scope: string;
  ids: readonly string[];
  visibleIds: readonly string[];
  unavailableIds?: readonly string[];
  revisions?: Readonly<Record<string, number>>;
  limit?: number;
}
export type OperationState =
  | 'initial'
  | 'loading'
  | 'empty'
  | 'draft'
  | 'validating'
  | 'approvalRequired'
  | 'submitting'
  | 'success'
  | 'validationError'
  | 'revisionConflict'
  | 'networkUnknown'
  | 'offline'
  | 'forbidden'
  | 'sessionChanged';
export interface OperationPresentation {
  taskId: string;
  state: OperationState;
  title: string;
  description?: string;
  closePolicy: 'allow' | 'retain' | 'blocked';
  scopeLabel?: string;
}
