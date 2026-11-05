import { DurableObject } from 'cloudflare:workers';
import type { Env } from './environment.js';
import type { HouseholdIdentity } from './household-store.js';
import { transferAttachment } from './attachment-transfer.js';
import { invoke } from './business-client.js';
import { DomainError } from '../../../packages/domain/src/index.js';

/** One capability-only object per household/upload. It coordinates the active transfer;
 * the household SQLite lease and confirmation remain the only durable upload facts.
 * No file bytes or duplicate inventory state are stored in this object's SQLite. */
export class AttachmentUpload extends DurableObject<Env> {
  private busy = false;

  async transfer(
    identity: HouseholdIdentity,
    id: string,
    ticket: string,
    body: ReadableStream<Uint8Array> | null,
  ): Promise<string> {
    if (this.busy) {
      await body?.cancel();
      return JSON.stringify({
        error: { code: 'STATE_CONFLICT', message: 'Upload is already in progress.' },
      });
    }
    this.busy = true;
    try {
      const context = { ...identity, env: this.env };
      const data = await transferAttachment(
        {
          uploadSize: (_identity, id, ticket) => invoke(context, 'uploadSize', { id, ticket }),
          beginUpload: (_identity, id, ticket, size, sha256) =>
            invoke(context, 'beginUpload', { id, ticket, size, sha256 }),
          confirmUpload: (_identity, id, lease, meta) =>
            invoke(context, 'confirmUpload', { id, lease, meta }),
        },
        identity,
        id,
        ticket,
        body,
        this.env.BLOBS,
      );
      return JSON.stringify({ data });
    } catch (error) {
      if (error instanceof DomainError)
        return JSON.stringify({
          error: { code: error.code, message: error.message, details: error.details },
        });
      throw error;
    } finally {
      this.busy = false;
    }
  }
}
