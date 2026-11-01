// Frozen frontend read contract v2 (2026-10-31).
// Source of truth: docs/repair/frozen-interfaces.md.
// Keep this file dependency-free: the web app and tests import it directly.

export type ProtocolVersion = 2;

export type FeatureKey =
  | 'query_v2'
  | 'history_v2'
  | 'snapshot_v2'
  | 'groups_v2'
  | 'profile_capabilities'
  | 'deadline'
  | 'stock'
  | 'notes_v2'
  | 'attachments'
  | 'void'
  | 'split'
  | 'references'
  | 'units_v2'
  | 'sync_v2'
  | 'redaction_v2'
  | 'protocol_v2';

export interface ConnectionContext {
  protocol: { current: 2; min: 2 };
  features: FeatureKey[];
  household: { id: string; name: string; timezone: string };
  actor: { id: string; name: string };
  connection?: {
    server_origin: string;
    mode: 'local' | 'cloud';
    scopes: string[];
  };
}

export type Profile = 'CONSUMABLE' | 'DURABLE' | 'WEARABLE' | 'SPACE' | 'MISC';
export type RecordState = 'VALID' | 'VOID';
export type Sensitivity = 'NORMAL' | 'SENSITIVE' | 'SECRET';
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export type CapabilityKey =
  | 'lifecycle.expiry'
  | 'lifecycle.opening'
  | 'contents'
  | 'stock'
  | 'asset'
  | 'custody'
  | 'service'
  | 'deadline'
  | 'clothing'
  | 'wardrobe'
  | 'container'
  | 'usage'
  | 'transport';

export interface AttributeBindingV2 {
  template_id: string;
  template_version: number;
  values: Record<string, unknown>;
  status: 'KNOWN' | 'UNKNOWN' | 'RETIRED';
}

export interface CatalogRecordV2 {
  id: string;
  parent_id: string | null;
  kind: 'GROUP' | 'SKU';
  name: string;
  revision: number;
  profile: Profile | null;
  capabilities: CapabilityKey[] | null;
  effective_capabilities: CapabilityKey[];
  one_off: boolean;
  record_state: RecordState;
  voided_at: string | null;
  attributes: AttributeBindingV2[];
  created_at: string;
  updated_at: string;
  redacted_paths: string[];
}

export interface DateFact {
  key: string;
  source: 'LIFECYCLE' | 'DEADLINE';
  kind: 'EXPIRY' | 'WARRANTY_END' | 'SERVICE_DUE' | 'RETURN_BY' | 'RENEWAL' | 'REORDER_BY';
  date_kind?: 'BEST_BEFORE' | 'USE_BY' | 'ESTIMATED';
  due_on: string;
  basis: string | null;
  state: 'UPCOMING' | 'DUE' | 'OVERDUE' | 'COMPLETED' | 'UNKNOWN';
  completed_on: string | null;
  label: string;
}

export interface SplitInfoV2 {
  split_id: string;
  source_item_id: string;
  child_item_ids: string[];
  count: number;
  created_at: string;
}

export interface ItemRecordV2 {
  id: string;
  parent_id: string | null;
  catalog_node_id: string;
  display_name: string | null;
  revision: number;
  record_state: RecordState;
  voided_at: string | null;
  effective_capabilities: CapabilityKey[];
  attributes: AttributeBindingV2[];
  created_at: string;
  updated_at: string;
  note_count: number;
  attachment_count: number;
  next_date: DateFact | null;
  split: SplitInfoV2 | null;
  redacted_paths: string[];
}

export interface ProductGroupV2 {
  id: string;
  name: string;
  profile: Profile | null;
  count: number;
  current_count: number;
  opened: number;
  sealed: number;
  unknown_opening: number;
  unknown_lifecycle: number;
  locations: number;
  totals: {
    unit: string;
    value: string;
    estimated: boolean;
    unknown_accuracy: boolean;
  }[];
  unknown_quantity: number;
  next_date: DateFact | null;
  overdue_count: number;
  low_stock: boolean | null;
}

export interface SnapshotV2 {
  protocol: 2;
  household: { id: string; name: string; timezone: string };
  as_of_change_id: string;
  server_time: string;
  catalog: CatalogRecordV2[];
  items: ItemRecordV2[];
  groups: ProductGroupV2[];
  cached_at: string;
}

export interface ItemQueryV2 {
  search?: string;
  name?: string;
  barcode?: string;
  catalog_node_ids?: string[];
  catalog_subtree_id?: string;
  within_item_id?: string;
  profile?: Profile;
  capabilities?: CapabilityKey[];
  attribute_filters?: {
    template_id: string;
    path: string;
    op: 'eq' | 'gte' | 'lte';
    value: unknown;
  }[];
  date_filters?: DateFilterV2[];
  include_path?: boolean;
  include_void?: boolean;
  include_terminal?: boolean;
  sort?: {
    field: 'created_at' | 'updated_at' | 'name' | 'reminder_date';
    direction: 'asc' | 'desc';
  };
  cursor?: string;
  limit?: number;
}

export interface DateFilterV2 {
  kind?: DateFact['kind'];
  source?: DateFact['source'];
  from?: string;
  to?: string;
  state?: DateFact['state'];
}

export interface ContentTotalsV2 {
  by_unit: Record<
    string,
    {
      value: string;
      measured_count: number;
      estimated_count: number;
      unknown_accuracy_count: number;
    }
  >;
  unknown_quantity_count: number;
  unconvertible_percentage_count: number;
}

export interface ItemQuerySummaryV2 {
  matching_count: number;
  current_count?: number;
  unknown_lifecycle_count?: number;
  content_totals?: ContentTotalsV2;
  as_of_change_id: string;
}

export interface ItemQueryResultV2 {
  data: ItemRecordV2[];
  next_cursor: string | null;
  matching_count: number;
  current_count: number;
  unknown_lifecycle_count: number;
  content_totals: ContentTotalsV2;
  as_of_change_id: string;
  stale: boolean;
  summary: ItemQuerySummaryV2;
}

export interface CatalogQueryV2 {
  kind?: 'GROUP' | 'SKU';
  include_hidden?: boolean;
  profile?: Profile;
  capabilities?: CapabilityKey[];
  search?: string;
  name?: string;
  barcode?: string;
  catalog_subtree_id?: string;
  attribute_filters?: ItemQueryV2['attribute_filters'];
  sort?: { field: 'created_at' | 'updated_at' | 'name'; direction: 'asc' | 'desc' };
  cursor?: string;
  limit?: number;
}

export interface CatalogQueryResultV2 {
  data: CatalogRecordV2[];
  next_cursor: string | null;
  matching_count: number;
  as_of_change_id: string;
  stale: boolean;
  summary: { matching_count: number; as_of_change_id: string };
}

export interface HistoryQueryV2 {
  target?: { kind: 'ITEM' | 'CATALOG_NODE'; id: string };
  operation_id?: string;
  event_type?: string;
  recorded_from?: string;
  recorded_to?: string;
  cursor?: string;
  limit?: number;
}

export interface HistoryEventV2 {
  id: string;
  target_kind: 'ITEM' | 'CATALOG_NODE';
  target_id: string;
  operation_id: string;
  event_type: string;
  before_revision: number;
  after_revision: number;
  changes: {
    path: string;
    before_present: boolean;
    after_present: boolean;
    before?: unknown;
    after?: unknown;
    template_id?: string;
    template_version?: number;
  }[];
  reason: string | null;
  actor_id: string;
  source: string;
  occurred_at: string;
  recorded_at: string;
}

export interface HistoryResultV2 {
  data: HistoryEventV2[];
  next_cursor: string | null;
  as_of_change_id: string;
  stale: boolean;
  summary: { as_of_change_id: string };
}

export interface NoteSummaryV2 {
  id: string;
  target: { kind: 'ITEM' | 'CATALOG_NODE'; id: string };
  title: string | null;
  excerpt: string;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  archived: boolean;
  sensitivity: Sensitivity;
}

export interface NoteV2 extends NoteSummaryV2 {
  body: string;
  body_format: 'Markdown';
}

export interface AttachmentSummaryV2 {
  id: string;
  target: { kind: 'ITEM' | 'CATALOG_NODE'; id: string } | { kind: 'NOTE'; id: string };
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  file_size: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  sort_order: number;
  sensitivity: Sensitivity;
  created_at: string;
  thumbnail_url: string | null;
}

export interface ItemDetailV2 {
  item: ItemRecordV2;
  path_ids: string[];
  dates: DateFact[];
  notes: NoteSummaryV2[];
  attachments: AttachmentSummaryV2[];
  split: SplitInfoV2 | null;
}

export interface TemplateFieldV2 {
  path: string;
  label: string;
  type:
    | 'string'
    | 'number'
    | 'decimal'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'enum'
    | 'measurement'
    | 'reference'
    | 'url';
  section: string;
  order: number;
  widget?:
    | 'text'
    | 'textarea'
    | 'select'
    | 'date'
    | 'number'
    | 'switch'
    | 'measurement'
    | 'reference'
    | 'photo'
    | 'link';
  unit?: string;
  options?: { value: string; label: string }[];
  help?: string;
  sensitivity?: Sensitivity;
}

export interface TemplateDefinitionV2 {
  id: string;
  version: number;
  name: string;
  target_kind: 'ITEM' | 'CATALOG_NODE';
  capability?: CapabilityKey;
  allowed_catalog_node_kinds: ('GROUP' | 'SKU')[];
  paths: string[];
  fields: TemplateFieldV2[];
  schema?: Record<string, unknown>;
}

export interface ReferenceV2 {
  kind: 'ACTOR' | 'ITEM' | 'CATALOG_NODE' | 'EXTERNAL';
  id?: string;
  name?: string;
}

export interface WriteResultV2 {
  operation_id: string;
  changed: boolean;
  affected_objects: {
    kind: 'ITEM' | 'CATALOG_NODE';
    id: string;
    before_revision: number;
    after_revision: number;
  }[];
  event_ids: string[];
  summary: string;
}
