import type {
  AttributeBindingV2,
  CatalogRecordV2,
  DateFact,
  ItemRecordV2,
  Profile,
  RecordState,
  Tone,
} from '../../../../../../packages/contracts/src/read-v2.js';
import type {
  Attribute,
  CatalogRecord,
  ItemRecord,
} from '../../../../../../packages/contracts/src/web.js';
import type {
  AttentionKind,
  CatalogView,
  FactView,
  ItemLocationView,
  ItemView,
  NoteView,
} from '../model/types.js';

export interface ItemAdaptContext {
  catalogName?: string;
  profile?: Profile | null;
  location?: ItemLocationView;
}

type StatusView = { label: string; tone: Tone };

const LIFECYCLE_STATUS: Record<string, StatusView> = {
  ACTIVE: { label: '在库', tone: 'success' },
  CONSUMED: { label: '已用完', tone: 'neutral' },
  DISPOSED: { label: '已丢弃', tone: 'neutral' },
  LOST: { label: '已遗失', tone: 'danger' },
  ARCHIVED: { label: '已归档', tone: 'neutral' },
};

const AVAILABILITY_STATUS: Record<string, StatusView> = {
  AVAILABLE: { label: '可用', tone: 'success' },
  IN_USE: { label: '使用中', tone: 'info' },
  LOANED: { label: '已借出', tone: 'warning' },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const textValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const recordValue = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const dateOnly = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

export function adaptBinding(binding: AttributeBindingV2 | Attribute): AttributeBindingV2 {
  const rawStatus = 'status' in binding ? binding.status : 'KNOWN';
  const status: AttributeBindingV2['status'] =
    rawStatus === 'UNKNOWN' || rawStatus === 'RETIRED' ? rawStatus : 'KNOWN';
  return {
    template_id: binding.template_id,
    template_version: binding.template_version,
    values: isRecord(binding.values) ? binding.values : {},
    status,
  };
}

export function adaptAttributes(
  attributes: readonly (AttributeBindingV2 | Attribute)[] | null | undefined,
): AttributeBindingV2[] {
  if (!Array.isArray(attributes)) return [];
  const adapted: AttributeBindingV2[] = [];
  for (const binding of attributes) {
    if (
      !isRecord(binding) ||
      typeof binding.template_id !== 'string' ||
      typeof binding.template_version !== 'number'
    )
      continue;
    adapted.push(adaptBinding(binding as unknown as AttributeBindingV2 | Attribute));
  }
  return adapted;
}

export function adaptCatalog(record: CatalogRecordV2 | CatalogRecord): CatalogView {
  const v2 = record as Partial<CatalogRecordV2>;
  return {
    id: record.id,
    parentId: record.parent_id,
    kind: record.kind,
    name: record.name,
    revision: record.revision,
    profile: v2.profile ?? null,
    capabilities: Array.isArray(v2.capabilities) ? [...v2.capabilities] : null,
    effectiveCapabilities: Array.isArray(v2.effective_capabilities)
      ? [...v2.effective_capabilities]
      : [],
    oneOff: v2.one_off === true,
    recordState: v2.record_state === 'VOID' ? 'VOID' : 'VALID',
    voidedAt: textValue(v2.voided_at) ?? null,
    redactedPaths: stringList(v2.redacted_paths),
    attributes: adaptAttributes(record.attributes),
  };
}

const bindingValues = (
  attributes: readonly AttributeBindingV2[],
  templateId: string,
): Record<string, unknown> | null => {
  const binding = attributes.find((candidate) => candidate.template_id === templateId);
  return binding ? recordValue(binding.values) : null;
};

const bindingVersion = (attributes: readonly AttributeBindingV2[], templateId: string): number =>
  attributes.find((candidate) => candidate.template_id === templateId)?.template_version ?? 1;

const statusFor = (
  recordState: RecordState,
  attributes: readonly AttributeBindingV2[],
): StatusView => {
  if (recordState === 'VOID') return { label: '已作废', tone: 'danger' };
  const lifecycle = bindingValues(attributes, 'lifecycle');
  const state = textValue(lifecycle?.state);
  if (state) return LIFECYCLE_STATUS[state] ?? { label: state, tone: 'neutral' };
  const availability = textValue(lifecycle?.availability);
  if (availability)
    return AVAILABILITY_STATUS[availability] ?? { label: availability, tone: 'neutral' };
  return { label: '未记录', tone: 'neutral' };
};

const factsFor = (attributes: readonly AttributeBindingV2[]): FactView[] => {
  const facts: FactView[] = [];
  const contents = bindingValues(attributes, 'contents');
  const remaining = recordValue(contents?.remaining);
  const remainingValue = textValue(remaining?.value);
  const remainingUnit = textValue(remaining?.unit);
  if (remainingValue && remainingUnit) {
    const amount =
      remainingUnit === 'percent' ? `${remainingValue}%` : `${remainingValue} ${remainingUnit}`;
    facts.push({
      kind: 'remaining',
      label: '剩余',
      value: textValue(contents?.accuracy) === 'ESTIMATED' ? `约 ${amount}` : amount,
      priority: 1,
      source: {
        templateId: 'contents',
        path: 'remaining',
        version: bindingVersion(attributes, 'contents'),
      },
    });
  }
  const lifecycle = bindingValues(attributes, 'lifecycle');
  const expiry = recordValue(lifecycle?.expiry);
  const expiryDate = textValue(expiry?.date);
  if (expiryDate && dateOnly(expiryDate)) {
    facts.push({
      kind: 'expiry',
      label: '到期',
      value: expiryDate,
      priority: 0,
      source: {
        templateId: 'lifecycle',
        path: 'expiry.date',
        version: bindingVersion(attributes, 'lifecycle'),
      },
    });
  }
  return facts.sort((left, right) => left.priority - right.priority);
};

const subtitleFor = (attributes: readonly AttributeBindingV2[]): string | undefined => {
  const product = bindingValues(attributes, 'product');
  const parts = [textValue(product?.brand), textValue(product?.specification)].filter(
    (part): part is string => part !== undefined,
  );
  return parts.length ? parts.join(' · ') : undefined;
};

const attentionFor = (
  record: { next_date?: DateFact | null },
  attributes: readonly AttributeBindingV2[],
): AttentionKind[] => {
  const attention: AttentionKind[] = [];
  if (record.next_date?.state === 'OVERDUE') attention.push('past');
  if (textValue(bindingValues(attributes, 'custody')?.status) === 'LOANED_OUT')
    attention.push('away');
  return attention;
};

const recordStateOf = (record: { record_state?: unknown }): RecordState =>
  record.record_state === 'VOID' ? 'VOID' : 'VALID';

export function adaptItem(
  record: ItemRecordV2 | ItemRecord,
  notes: readonly NoteView[],
  context: ItemAdaptContext = {},
): ItemView {
  const v2 = record as Partial<ItemRecordV2>;
  const attributes = adaptAttributes(record.attributes);
  const recordState = recordStateOf(record as { record_state?: unknown });
  const timestamps = record as { updated_at?: unknown; created_at?: unknown };
  const catalogName =
    textValue((record as { catalog_name?: unknown }).catalog_name) ?? context.catalogName;
  const name = textValue(record.display_name) ?? catalogName ?? '未命名物品';
  const subtitle = subtitleFor(attributes);
  const location: ItemLocationView = context.location
    ? { id: context.location.id, path: [...context.location.path], label: context.location.label }
    : { id: record.parent_id, path: [], label: '未记录位置' };
  return {
    id: record.id,
    skuId: record.catalog_node_id,
    name,
    ...(subtitle === undefined ? {} : { subtitle }),
    location,
    profile: context.profile ?? null,
    status: statusFor(recordState, attributes),
    facts: factsFor(attributes),
    attention: attentionFor(record as { next_date?: DateFact | null }, attributes),
    revision: record.revision,
    updatedAt: textValue(timestamps.updated_at) ?? textValue(timestamps.created_at) ?? '',
    recordState,
    voidedAt: textValue((record as { voided_at?: unknown }).voided_at) ?? null,
    redactedPaths: stringList((record as { redacted_paths?: unknown }).redacted_paths),
    noteCount: typeof v2.note_count === 'number' ? v2.note_count : notes.length,
    attachmentCount: typeof v2.attachment_count === 'number' ? v2.attachment_count : 0,
  };
}
