import type { HouseholdStore } from './household-store.js';
import type { AttachmentUpload } from './attachment-upload.js';
export interface Env {
  AUTH_DB: D1Database;
  HOUSEHOLDS: DurableObjectNamespace<HouseholdStore>;
  UPLOADS: DurableObjectNamespace<AttachmentUpload>;
  BLOBS: R2Bucket;
  BACKUPS: R2Bucket;
  JOBS: Queue;
  ASSETS: Fetcher;
  ORIGIN: string;
  AUTH_SECRET: string;
  TERMINAL_CLIENT_ID?: string;
  TERMINAL_SIGNING_FINGERPRINTS?: string;
  RELEASE_VERSION: string;
  RELEASE_COMMIT: string;
  ENVIRONMENT: 'preview' | 'production' | 'test';
}
export const household = (env: Pick<Env, 'HOUSEHOLDS'>, id: string) =>
  env.HOUSEHOLDS.get(env.HOUSEHOLDS.idFromName(id));
