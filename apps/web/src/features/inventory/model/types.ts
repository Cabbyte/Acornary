import type {
  AttributeBindingV2,
  CapabilityKey,
  DateFact,
  Profile,
  RecordState,
  Sensitivity,
  SplitInfoV2,
  Tone,
} from '../../../../../../packages/contracts/src/read-v2.js';

export type { Tone };

export type AttentionKind = 'past' | 'soon' | 'low' | 'away';

export type FactKind =
  'remaining' | 'expiry' | 'opening' | 'condition' | 'warranty' | 'loan' | 'deadline' | 'custom';

export interface FactSourceView {
  templateId: string;
  path: string;
  version: number;
}

export interface FactView {
  kind: FactKind;
  label: string;
  value: string;
  tone?: Tone;
  priority: number;
  source?: FactSourceView;
}

export interface ItemLocationView {
  id: string | null;
  path: string[];
  label: string;
}

export interface ItemStatusView {
  label: string;
  tone: Tone;
}

export interface ItemView {
  id: string;
  skuId: string;
  name: string;
  subtitle?: string;
  location: ItemLocationView;
  profile: Profile | null;
  status: ItemStatusView;
  facts: FactView[];
  attention: AttentionKind[];
  thumbnailUrl?: string;
  revision: number;
  updatedAt: string;
  recordState: RecordState;
  voidedAt: string | null;
  redactedPaths: string[];
  noteCount: number;
  attachmentCount: number;
}

export interface GroupTotalView {
  unit: string;
  value: string;
  estimated: boolean;
  unknownAccuracy: boolean;
}

export interface GroupView {
  id: string;
  name: string;
  profile: Profile | null;
  count: number;
  currentCount: number;
  opened: number;
  sealed: number;
  unknownOpening: number;
  unknownLifecycle: number;
  locations: number;
  totals: GroupTotalView[];
  unknownQuantity: number;
  nextDate?: DateFactView | null;
  overdueCount: number | null;
  lowStock: boolean | null;
  hasItemIds: boolean;
}

export interface LocationView {
  id: string;
  parentId: string | null;
  name: string;
  count?: number;
}

export interface CatalogView {
  id: string;
  parentId: string | null;
  kind: 'GROUP' | 'SKU';
  name: string;
  revision: number;
  profile: Profile | null;
  capabilities: CapabilityKey[] | null;
  effectiveCapabilities: CapabilityKey[];
  oneOff: boolean;
  recordState: RecordState;
  voidedAt: string | null;
  redactedPaths: string[];
  attributes: AttributeBindingV2[];
}

export interface NoteView {
  id: string;
  itemId: string;
  title: string | null;
  excerpt: string;
  body?: string;
  updatedAt: string;
  sensitivity: Sensitivity;
}

export type DateState = DateFact['state'];

export interface DateFactView {
  key: string;
  source: DateFact['source'];
  kind: DateFact['kind'];
  dueOn: string;
  basis: string | null;
  state: DateState;
  completedOn: string | null;
  label: string;
}

export interface AttachmentView {
  id: string;
  targetKind: 'ITEM' | 'CATALOG_NODE' | 'NOTE';
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  sortOrder: number;
  sensitivity: Sensitivity;
  thumbnailUrl: string | null;
}

export interface InventoryView {
  household: { id: string; name: string; timezone: string };
  asOfChangeId: string;
  catalog: CatalogView[];
  items: ItemView[];
  groups: GroupView[];
  notesByItem: Record<string, NoteView[]>;
  capabilities: Record<string, boolean>;
  cachedAt: string;
}

export interface ItemDetailView {
  item: ItemView;
  pathIds: string[];
  dates: DateFactView[];
  notes: NoteView[];
  attachments: AttachmentView[];
  split: SplitInfoV2 | null;
}
