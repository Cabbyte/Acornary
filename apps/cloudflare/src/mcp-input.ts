import { z } from 'zod';

// Advertise the exact public contract, but validate within our callback so the
// SDK does not turn structured domain rejections into text-only errors.
// Every callback using this adapter MUST parse before executing any operation.
export function deferredInput(schema: z.ZodType) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'acornary',
      validate: (value: unknown) => ({ value }),
      jsonSchema: {
        input: () => z.toJSONSchema(schema, { io: 'input' }),
        output: () => z.toJSONSchema(schema, { io: 'output' }),
      },
    },
  };
}
