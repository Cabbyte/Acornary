import { z } from 'zod';
import { entityId } from '../../../../packages/contracts/src/ids.js';
import { schemas, reads, type Operation } from '../../../../packages/contracts/src/index.js';

const values = z.record(z.string(), z.string());
export const draftSchema = z
  .object({
    values,
    original: values,
    revisions: z.record(z.string(), z.number().int().positive()),
    attempt: z
      .object({ operation: z.string(), payload: z.record(z.string(), z.unknown()) })
      .optional(),
    result: z
      .object({
        operation_id: z.string(),
        changed: z.boolean(),
        event_ids: z.array(z.string()),
        note_id: z.string().optional(),
        affected_objects: z.array(
          z.object({
            kind: z.enum(['ITEM', 'CATALOG_NODE']),
            id: z.union([entityId('item'), entityId('catalog_node')]),
            before_revision: z.number().int(),
            after_revision: z.number().int(),
          }),
        ),
      })
      .optional(),
  })
  .superRefine((draft, ctx) => {
    if (draft.result && !draft.attempt)
      ctx.addIssue({ code: 'custom', message: 'Committed draft has no original request' });
    if (draft.attempt) {
      const operation = draft.attempt.operation as Operation;
      if (
        !Object.hasOwn(schemas, operation) ||
        reads.has(operation) ||
        !schemas[operation].safeParse(draft.attempt.payload).success
      )
        ctx.addIssue({ code: 'custom', message: 'Invalid original command' });
    }
  });
