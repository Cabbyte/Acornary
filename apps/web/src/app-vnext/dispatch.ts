/** Extracted from ActionSheet: save the exact attempt before dispatch, then save
 * the receipt before acknowledging completion. No transport/storage is chosen here.
 * A rejected receipt save is still an uncertain request, never a fresh attempt. */
export async function dispatchPersistedAttempt<Pending, Result>(ports: {
  pending: Pending;
  persistPending: (pending: Pending) => void | Promise<void>;
  execute: () => Promise<Result>;
  persistResult: (result: Result) => void | Promise<void>;
}): Promise<Result> {
  await ports.persistPending(ports.pending);
  const result = await ports.execute();
  await ports.persistResult(result);
  return result;
}
