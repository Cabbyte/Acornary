import { debugRead } from '../../apps/cloudflare/src/inventory/debug.js';
import {
  transferAttachment,
  downloadAttachment,
} from '../../apps/cloudflare/src/attachment-transfer.js';
// Test-only inspection and fault injection. Never a deployment entrypoint.
import {
  HouseholdStore,
  type HouseholdIdentity,
} from '../../apps/cloudflare/src/household-store.js';
export class TestInventory extends HouseholdStore {
  debug(identity: HouseholdIdentity, input: unknown) {
    return this.authorized(identity, false, (ctx) => debugRead(ctx, input));
  }
  inspect(sql: string, bindings: unknown[] = []) {
    return this.db.transaction(() => this.db.query(sql, bindings).rows);
  }
}
export default {
  async fetch(
    request: Request,
    env: { HOUSEHOLDS: DurableObjectNamespace<TestInventory>; BLOBS: R2Bucket },
  ) {
    if (new URL(request.url).pathname === '/upload') {
      const identity = JSON.parse(request.headers.get('x-test-identity')!);
      try {
        return Response.json(
          await transferAttachment(
            env.HOUSEHOLDS.getByName(identity.household_id),
            identity,
            request.headers.get('x-test-upload')!,
            request.headers.get('x-test-ticket')!,
            request.body,
            env.BLOBS,
          ),
        );
      } catch (error: any) {
        return Response.json({ code: error.code, message: error.message }, { status: 400 });
      }
    }
    if (new URL(request.url).pathname === '/download') {
      const identity = JSON.parse(request.headers.get('x-test-identity')!);
      try {
        return await downloadAttachment(
          env.HOUSEHOLDS.getByName(identity.household_id),
          identity,
          request.headers.get('x-test-attachment')!,
          undefined,
          request.headers.get('x-test-reveal') === 'true',
          env.BLOBS,
        );
      } catch (error: any) {
        return Response.json({ code: error.code, message: error.message }, { status: 400 });
      }
    }
    const { route, method, args } = (await request.json()) as {
      route: string;
      method: string;
      args: any[];
    };
    try {
      const stub = env.HOUSEHOLDS.getByName(route);
      if (
        ![
          'freezeBackup',
          'backupPage',
          'releaseBackup',
          'beginRestore',
          'restorePart',
          'finishRestore',
          'backupBlobPage',
          'confirmRestoredBlob',
          'activateRestore',
          'maintenancePlan',
          'acknowledgeCleanup',
          'create',
          'command',
          'review',
          'confirm',
          'snapshot',
          'synchronize',
          'inspect',
          'debug',
          'beginImport',
          'importPart',
          'finishImport',
          'activateImport',
          'importStatus',
          'importBlobPage',
          'confirmImportedBlob',
          'beginUpload',
          'confirmUpload',
          'downloadMetadata',
        ].includes(method)
      )
        return new Response(null, { status: 404 });
      const result = await (stub as any)[method](...args);
      return Response.json(result ?? null);
    } catch (error: any) {
      return Response.json(
        { code: error.code, message: error.message, stack: error.stack },
        { status: 400 },
      );
    }
  },
};
export { MigrationEntrypoint } from '../../apps/cloudflare/src/migration-entrypoint.js';
