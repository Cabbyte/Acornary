import type { Operation } from '../../../../packages/contracts/src/index.js';
import type { InventorySnapshot, WriteResult } from '../../../../packages/contracts/src/web.js';

export interface InventoryTransport {
  snapshot(signal?: AbortSignal): Promise<InventorySnapshot>;
  read<T>(name: Operation, input: unknown, signal?: AbortSignal): Promise<T>;
  write(
    name: Operation,
    payload: unknown,
    household?: string,
    userId?: string,
    scope?: string,
  ): Promise<WriteResult>;
  request<T>(url: string): Promise<T>;
}
export interface RecordStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}
export interface Selection {
  kind: 'ITEM' | 'CATALOG_NODE';
  id: string;
  revision: number;
  name: string;
  location: string;
}
export interface EmbeddedRuntime {
  transport: InventoryTransport;
  storage: RecordStore;
  select(selection: Selection | null): void;
  rememberRoute?(route: string): void;
}
// One immutable adapter per browser realm. The website never installs an adapter;
// each sandboxed MCP UI installs its own before React mounts.
let embedded: EmbeddedRuntime | undefined;
export function installEmbeddedRuntime(runtime: EmbeddedRuntime) {
  if (embedded) throw new Error('Runtime already installed');
  embedded = runtime;
}
export const embeddedRuntime = () => embedded;
