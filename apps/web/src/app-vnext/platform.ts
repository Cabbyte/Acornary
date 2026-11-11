import type { Operation } from '../../../../packages/contracts/src/index';
import type { WriteResult } from '../../../../packages/contracts/src/web';
import type { ApplicationScope } from './scope';

/** Implementations must acknowledge durable storage before returning from save. */
export interface OperationStorage {
  load(scope: ApplicationScope, key: string): unknown;
  save(scope: ApplicationScope, key: string, value: unknown): void | Promise<void>;
}
export interface CommandAttempt {
  operation: Operation;
  payload: Record<string, unknown>;
}
export interface ApplicationPlatform {
  storage: OperationStorage;
  commands: {
    execute(scope: ApplicationScope, attempt: CommandAttempt): Promise<WriteResult>;
    recover(scope: ApplicationScope, attempt: CommandAttempt): Promise<WriteResult>;
  };
  navigation: { open(path: string, replace?: boolean): void; back(fallback: string): void };
  scan?: { read(signal: AbortSignal): Promise<string> };
  print?: { send(scope: ApplicationScope, jobId: string): Promise<void> };
}
