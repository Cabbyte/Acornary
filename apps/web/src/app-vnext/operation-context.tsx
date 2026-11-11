import { createContext, useContext, useState, type ReactNode } from 'react';
import { sameGeneration, scopeKey, type ApplicationScope } from './scope';
/** A registry belongs to the application root, outside route and mode outlets. */
export class OperationSessions {
  private sessions = new Map<string, unknown>();
  isSubmitting() {
    return [...this.sessions.values()].some(
      (session) =>
        (session as { getSnapshot(): { state: string } }).getSnapshot().state === 'submitting',
    );
  }
  async retain(scope: ApplicationScope) {
    for (const value of this.sessions.values()) {
      const session = value as {
        getSnapshot(): { scope: ApplicationScope };
        retain(): Promise<boolean>;
      };
      if (sameGeneration(session.getSnapshot().scope, scope) && !(await session.retain()))
        return false;
    }
    return true;
  }
  hasUnpersisted(scope: ApplicationScope) {
    return [...this.sessions.values()].some((value) => {
      const session = value as {
        hasUnpersisted(): boolean;
        getSnapshot(): { scope: ApplicationScope };
      };
      return sameGeneration(session.getSnapshot().scope, scope) && session.hasUnpersisted();
    });
  }
  get<T extends { getSnapshot(): { state: string } }>(
    scope: ApplicationScope,
    taskId: string,
    create: () => T,
  ): T {
    const key = `${scopeKey(scope)}:${scope.generation}:${taskId}`;
    if (!this.sessions.has(key)) this.sessions.set(key, create());
    return this.sessions.get(key) as T;
  }
}
const Context = createContext<OperationSessions | null>(null);
export function OperationSessionProvider({ children }: { children: ReactNode }) {
  const [sessions] = useState(() => new OperationSessions());
  return <Context.Provider value={sessions}>{children}</Context.Provider>;
}
export function useOperationSessions() {
  const sessions = useContext(Context);
  if (!sessions) throw Error('OperationSessionProvider must be held above the route outlet.');
  return sessions;
}
export const useOptionalOperationSessions = () => useContext(Context);
