// Known, definitive domain rejections. Unknown/transport errors must retain the
// original idempotent request because their commit outcome is not established.
const statuses: Record<string, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  SESSION_CHANGED: 409,
  ATTRIBUTE_VALIDATION_FAILED: 400,
  INVALID_PARENT: 400,
  CYCLE_DETECTED: 400,
  MISSING_FACTS: 400,
  INSUFFICIENT_CONTENT: 400,
  UNIT_MISMATCH: 400,
  INVALID_TRANSITION: 400,
  BARCODE_CONFLICT: 400,
  TEMPLATE_IN_USE: 400,
};
export const domainErrorStatus = (code: string): number | undefined =>
  Object.hasOwn(statuses, code) ? statuses[code] : undefined;
