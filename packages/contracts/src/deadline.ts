import { z } from 'zod';
import { uuidPattern } from './ids.js';

export const deadlineId = z.string().regex(new RegExp(`^deadline_${uuidPattern}$`));
export const deadlineKind = z.enum([
  'WARRANTY_END',
  'SERVICE_DUE',
  'RETURN_BY',
  'RENEWAL',
  'REORDER_BY',
]);
export const deadlineInput = z.strictObject({
  kind: deadlineKind,
  due_on: z.iso.date(),
  recurrence_days: z.int().positive().max(36500).nullable().optional(),
  basis: z.string().max(500).optional(),
  note: z.string().max(100000).optional(),
});
export const deadlineEntry = deadlineInput.extend({
  id: deadlineId,
  last_completed_on: z.iso.date().nullable().optional(),
});
export type DeadlineEntry = z.infer<typeof deadlineEntry>;
export type DeadlineKind = z.infer<typeof deadlineKind>;
export const deadlineTemplate = {
  target_kind: 'ITEM',
  paths: ['entries'],
  schema: z.strictObject({
    entries: z
      .array(deadlineEntry)
      .refine(
        (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
        'Duplicate deadline IDs.',
      ),
  }),
} as const;
// Completion needs this frozen template even before the profile/registry lane lands.
export const deadlineServiceTemplate = {
  target_kind: 'ITEM',
  paths: ['state', 'last_service_on', 'interval_days', 'provider', 'note'],
  schema: z.strictObject({
    state: z.enum(['NONE', 'CLEANING', 'REPAIR', 'MAINTENANCE']).optional(),
    last_service_on: z.iso.date().optional(),
    interval_days: z.int().positive().max(36500).optional(),
    provider: z.string().max(500).optional(),
    note: z.string().max(100000).optional(),
  }),
} as const;
export const dateState = z.enum(['UPCOMING', 'DUE', 'OVERDUE', 'COMPLETED', 'UNKNOWN']);
export const dateFilter = z
  .strictObject({
    kind: z.enum(['EXPIRY', ...deadlineKind.options]).optional(),
    source: z.enum(['LIFECYCLE', 'DEADLINE']).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    state: dateState.optional(),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, 'Invalid date range.');
export type DateFilter = z.infer<typeof dateFilter>;
export type DateSource = 'LIFECYCLE' | 'DEADLINE';
export type DateState = z.infer<typeof dateState>;
export type DateFact = {
  key: string;
  source: DateSource;
  kind: 'EXPIRY' | DeadlineKind;
  date_kind?: 'BEST_BEFORE' | 'USE_BY' | 'ESTIMATED';
  due_on: string;
  basis: string | null;
  state: DateState;
  completed_on: string | null;
  label: string;
};
