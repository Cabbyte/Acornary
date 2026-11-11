/** Stable data ownership and ephemeral response ownership are separate. */
export interface ApplicationScope {
  environment: string;
  accountId: string;
  householdId: string;
  clientId: string;
  datasetId: string;
  generation: number;
}
export const scopeKey = (scope: ApplicationScope) =>
  JSON.stringify([
    scope.environment,
    scope.accountId,
    scope.householdId,
    scope.clientId,
    scope.datasetId,
  ]);
export const sameScope = (left: ApplicationScope, right: ApplicationScope) =>
  scopeKey(left) === scopeKey(right);
export const sameGeneration = (left: ApplicationScope, right: ApplicationScope) =>
  sameScope(left, right) && left.generation === right.generation;
