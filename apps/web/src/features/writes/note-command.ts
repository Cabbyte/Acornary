import { schemas, type Operation } from '../../../../../packages/contracts/src/index.js';

/** Commands persist exactly as issued; v1 item_id note payloads are no longer accepted. */
export function parseWriteCommand(operation: Operation, payload: unknown) {
  return schemas[operation].safeParse(payload);
}
export function validPersistedCommand(operation: Operation, payload: Record<string, unknown>) {
  return schemas[operation].safeParse(payload).success;
}
