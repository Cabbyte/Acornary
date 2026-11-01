import { z } from 'zod';

export const coreSearchSchema = z.object({
  ui: z.enum(['next', 'legacy']).optional().catch(undefined),
  view: z.enum(['all', 'attention']).optional().catch(undefined),
  location: z.string().optional().catch(undefined),
  category: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  sort: z.enum(['attention', 'name', 'created']).optional().catch(undefined),
});
export type CoreSearch = z.infer<typeof coreSearchSchema>;
/** Preserve legacy dialog/link parameters, but never accept a pagination cursor in the URL. */
export function validateWorkspaceSearch(
  input: Record<string, unknown>,
): CoreSearch & Record<string, unknown> {
  const { cursor: _cursor, ...rest } = input;
  return { ...rest, ...coreSearchSchema.parse(input) };
}
export function readCoreSearch(search: string): CoreSearch {
  return coreSearchSchema.parse(Object.fromEntries(new URLSearchParams(search)));
}
