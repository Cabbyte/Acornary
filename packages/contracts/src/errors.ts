// Known, definitive domain rejections. Unknown/transport errors must retain the
// original idempotent request because their commit outcome is not established.
const statuses: Record<string, number> = {
  POLICY_REQUIRED: 409,
  POLICY_CONFLICT: 409,
  CLASSIFICATION_CONFLICT: 409,
  AMBIGUOUS_PRODUCT: 409,
  APPROVAL_REQUIRED: 409,
  APPROVAL_EXPIRED: 409,

  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  MISSING_EXPECTED_REVISION: 400,
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

export function errorRecovery(code: string) {
  if (code === 'REVISION_CONFLICT') return 'REREAD_AND_REVIEW';
  if (code === 'IDEMPOTENCY_CONFLICT') return 'RECOVER_ORIGINAL_REQUEST';
  if (['UNAUTHORIZED', 'FORBIDDEN', 'SESSION_CHANGED'].includes(code)) return 'REAUTHORIZE';
  return domainErrorStatus(code) ? 'FIX_REQUEST' : 'RETRY_SAME_REQUEST';
}
