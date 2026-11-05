import { WorkerEntrypoint } from 'cloudflare:workers';
import { household, type Env } from './environment.js';
import { Memberships } from './memberships.js';
import { householdImportDescriptor, sha } from './household-import-model.js';
import { BlobSnapshotImporter } from './blob-import.js';

/** Explicit account-authorized service binding, never reachable through the application's public router.
 * Operators connect with Wrangler OAuth and a remote service binding to this named entrypoint. */
export class MigrationEntrypoint extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const text = await request.text();
      if (Buffer.byteLength(text) > 512 * 1024)
        throw new Error('Migration request exceeds chunk limit');
      const body = JSON.parse(text),
        hash = body.manifest_hash;
      if (
        typeof hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(hash) ||
        typeof body.household_id !== 'string' ||
        !/^household_[a-f0-9-]{36}$/.test(body.household_id)
      )
        throw new Error('Explicit manifest and household required');
      const job = await this.env.AUTH_DB.prepare(
        "SELECT descriptor FROM cf_auth_import WHERE singleton=1 AND manifest_hash=? AND state='AUTH_IMPORTED'",
      )
        .bind(hash)
        .first<{ descriptor: string }>();
      if (!job) throw new Error('Matching completed D1 identity import required');
      const authDescriptor = JSON.parse(job.descriptor);
      if (authDescriptor.mode !== this.env.ENVIRONMENT)
        throw new Error('Import mode differs from the deployment environment');
      const member = await this.env.AUTH_DB.prepare('SELECT id FROM household_directory WHERE id=?')
        .bind(body.household_id)
        .first();
      if (!member) throw new Error('Household is absent from the imported directory');
      const store = household(this.env, body.household_id),
        path = new URL(request.url).pathname;
      let result: unknown;
      switch (path) {
        case '/begin': {
          const descriptor = householdImportDescriptor.parse(body.descriptor);
          if (
            descriptor.household_id !== body.household_id ||
            descriptor.manifest_hash !== hash ||
            descriptor.mode !== authDescriptor.mode
          )
            throw new Error('Household descriptor does not match the selected import');
          result = await store.beginImport(descriptor);
          break;
        }
        case '/part':
          result = await store.importPart(hash, body.ordinal, body.body, body.proof);
          break;
        case '/finish':
          result = await store.finishImport(hash);
          break;
        case '/status':
          result = await store.importStatus();
          break;
        case '/verify-blobs': {
          const object = await this.env.BACKUPS.get(`migrations/${hash}/manifest.json`);
          if (!object || object.size > 8 * 1024 * 1024)
            throw new Error('Anchored source manifest missing');
          const raw = await object.text();
          if (sha(raw) !== hash) throw new Error('Stored source manifest digest mismatch');
          const manifest = JSON.parse(raw);
          if (
            manifest.format !== 'acornary-cloudflare-snapshot-v1' ||
            manifest.mode !== authDescriptor.mode
          )
            throw new Error('Invalid source manifest');
          const page = await store.importBlobPage(
            hash,
            typeof body.after === 'string' ? body.after : '',
          );
          const verifier = new BlobSnapshotImporter(this.env.BLOBS);
          for (const { storage_key: key } of page) {
            const blob = manifest.blobs[key];
            if (!blob) throw new Error('Attachment is absent from anchored source manifest');
            await verifier.verify(key, blob);
            await store.confirmImportedBlob(hash, key, blob.bytes, blob.sha256);
          }
          result = {
            verified: page.length,
            next: page.length === 10 ? page.at(-1)!.storage_key : null,
          };
          break;
        }
        case '/activate':
          result = await store.activateImport(hash);
          await new Memberships(this.env).project(body.household_id);
          break;
        default:
          return new Response(null, { status: 404 });
      }
      return Response.json({ data: result });
    } catch (error) {
      // The authenticated operator needs a failure category, never SQL text or source rows.
      return Response.json(
        {
          error:
            error instanceof Error && !/SQL|D1_|constraint/i.test(error.message)
              ? error.message
              : 'Migration rejected; destination remains isolated.',
        },
        { status: 409 },
      );
    }
  }
}
