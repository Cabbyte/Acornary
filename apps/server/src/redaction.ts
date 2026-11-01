import { randomUUID } from 'node:crypto';
import { query, type Client } from './db.js';
import type { Context } from './service.js';
import type { Sensitivity } from '../../../packages/contracts/src/notes.js';
import { requireFact } from '../../../packages/domain/src/index.js';
export type SensitivityPaths = Record<string, Sensitivity>;
export type RedactionScope =
  | 'list'
  | 'summary'
  | 'detail'
  | 'sync'
  | 'history'
  | 'receipt'
  | 'inspect'
  | 'export'
  | 'error'
  | 'log';
const audited = new WeakSet<object>();
type Reveal = { scope: 'detail'; audit: object };
// Only a successful audit insertion can create a reveal capability. No boolean bypass.
export async function auditReveal(
  c: Client,
  ctx: Context,
  kind: string,
  id: string,
): Promise<Reveal> {
  await query(
    c,
    'INSERT INTO sensitive_access_audit(household_id,actor_id,target_kind,target_id,scope) VALUES($1,$2,$3,$4,$5)',
    [ctx.household_id, ctx.actor_id, kind, id, 'detail'],
  );
  const audit = { id: randomUUID() };
  audited.add(audit);
  return { scope: 'detail', audit };
}
export function redactFor<T extends Record<string, any>>(
  scope: RedactionScope | Reveal,
  value: T,
  sensitivityPaths: SensitivityPaths,
): T & { redacted_paths: string[] } {
  const reveal = typeof scope !== 'string';
  if (reveal)
    requireFact(
      scope.scope === 'detail' && audited.has(scope.audit),
      'REVEAL_AUDIT_REQUIRED',
      'Audited detail access required.',
    );
  const result = structuredClone(value) as T & { redacted_paths: string[] };
  result.redacted_paths = [...(value.redacted_paths ?? [])];
  for (const [path, sensitivity] of Object.entries(sensitivityPaths)) {
    if (sensitivity === 'NORMAL' || reveal) continue;
    const parts = path.split('.');
    let parent: any = result;
    for (const part of parts.slice(0, -1)) parent = parent?.[part];
    if (parent && Object.hasOwn(parent, parts.at(-1)!)) {
      delete parent[parts.at(-1)!];
      result.redacted_paths.push(path);
    }
  }
  return result;
}
