import { HouseholdImporter } from './household-import.js';
import { traces, newTrace, traceMetadata } from './inventory/telemetry.js';
import { debugRead } from './inventory/debug.js';
import { terminalCommand, type TerminalCommand } from '../../../packages/contracts/src/terminal.js';
import {
  directoryEvent,
  householdTask,
  type HouseholdTask,
  type DirectoryEvent,
  type AccountResult,
} from './household-accounts.js';
import { terminalSnapshot } from './inventory/terminal.js';
import {
  beginUpload,
  confirmUpload,
  downloadMetadata,
  type UploadedMetadata,
} from './inventory/attachments.js';
import { DurableObject } from 'cloudflare:workers';
import { NativeDatabase } from './inventory/db.js';
import { execute, type Context } from './inventory/service.js';
import { reviewCatalogProposal, confirmCatalogProposal } from './inventory/intake.js';
import { webSnapshotV2 } from './inventory/web.js';
import { syncState, syncChanges, syncBootstrap, syncFetch } from './inventory/sync-api.js';
import { DomainError, requireFact } from '../../../packages/domain/src/index.js';
import {
  templates,
  templateDefinition,
  latestTemplateVersion,
  reads,
  type TemplateId,
  type Operation,
} from '../../../packages/contracts/src/index.js';
import { fileReads } from '../../../packages/contracts/src/notes.js';
import { publishTemplate } from './inventory/registry.js';

export type HouseholdIdentity = Pick<
  Context,
  'household_id' | 'user_id' | 'actor_id' | 'source' | 'connection'
>;
// RPC-only: callers obtain this capability from the Worker binding after authenticating the D1 principal.
// Public HTTP requests never supply user/actor IDs to these methods.
export class HouseholdStore extends DurableObject<{}> {
  protected readonly db: NativeDatabase;
  constructor(ctx: DurableObjectState, env: {}) {
    super(ctx, env);
    this.db = new NativeDatabase(ctx.storage);
    this.db.initialize();
  }
  beginImport(descriptor: unknown) {
    return new HouseholdImporter(this.db).begin(descriptor);
  }
  importPart(manifest: string, ordinal: number, body: string, proof: string[]) {
    return new HouseholdImporter(this.db).part(manifest, ordinal, body, proof);
  }
  finishImport(manifest: string) {
    return new HouseholdImporter(this.db).finish(manifest);
  }
  activateImport(manifest: string) {
    return new HouseholdImporter(this.db).activate(manifest);
  }
  importBlobPage(manifest: string, after: string) {
    return new HouseholdImporter(this.db).blobPage(manifest, after);
  }
  confirmImportedBlob(manifest: string, key: string, bytes: number, digest: string) {
    return new HouseholdImporter(this.db).confirmBlob(manifest, key, bytes, digest);
  }
  importStatus() {
    return new HouseholdImporter(this.db).status();
  }
  resolveMember(
    householdId: string,
    userId: string,
  ): {
    id: string;
    household_id: string;
    actor_id: string;
    name: string;
    actor_name: string;
    joined_at: string;
  } | null {
    return this.db.transaction(() => {
      const state = this.db.query(
        'SELECT household_id,status FROM cf_store_state WHERE singleton=1',
      ).rows[0];
      if (!state || state.household_id !== householdId || state.status === 'IMPORTING') return null;
      return (
        this.db.query(
          `SELECT m.id,m.household_id,m.actor_id,h.name,a.name AS actor_name,m.joined_at FROM household_members m JOIN households h ON h.id=m.household_id JOIN actors a ON a.id=m.actor_id WHERE m.household_id=?1 AND m.user_id=?2`,
          [householdId, userId],
        ).rows[0] ?? null
      );
    });
  }
  protected authorized<T>(
    identity: HouseholdIdentity,
    write: boolean,
    action: (ctx: Context) => T,
  ): T {
    return this.db.transaction(() => {
      const state = this.db.query('SELECT * FROM cf_store_state WHERE singleton=1').rows[0];
      requireFact(
        state && state.household_id === identity.household_id,
        'FORBIDDEN',
        'Invalid household context.',
      );
      requireFact(
        state.status !== 'IMPORTING',
        'STATE_CONFLICT',
        'Household migration is incomplete.',
      );
      const member = this.db.query(
        'SELECT id FROM household_members WHERE household_id=?1 AND user_id=?2 AND actor_id=?3',
        [identity.household_id, identity.user_id, identity.actor_id],
      ).rows[0];
      requireFact(member, 'FORBIDDEN', 'Household membership is no longer active.');
      if (write)
        requireFact(
          state.status === 'ACTIVE',
          'STATE_CONFLICT',
          'Household writes are temporarily paused.',
        );
      return action({ ...identity, db: this.db });
    });
  }
  /** Preserve structured domain errors across the Worker/DO RPC boundary. */
  rpc(identity: HouseholdIdentity, action: string, input: string): string {
    return traces.run(newTrace(), () => {
      try {
        const args = JSON.parse(input);
        let data: unknown;
        switch (action) {
          case 'command':
            data = this.command(identity, args.name, args.input);
            break;
          case 'review':
            data = this.review(identity, args.scope, args.input);
            break;
          case 'confirm':
            data = this.confirm(identity, args.scope, args.input);
            break;
          case 'snapshot':
            data = this.snapshot(identity);
            break;
          case 'sync':
            data = this.synchronize(identity, args.name, args.input);
            break;
          case 'context':
            data = this.authorized(identity, false, (ctx) => ({
              household: this.db.query('SELECT * FROM households WHERE id=?1', [ctx.household_id])
                .rows[0],
              container_catalog_id: this.db.query(
                'SELECT container_catalog_id FROM household_settings WHERE household_id=?1',
                [ctx.household_id],
              ).rows[0]?.container_catalog_id,
            }));
            break;
          case 'debug':
            data = this.authorized(identity, false, (ctx) => debugRead(ctx, args));
            break;
          case 'terminalSnapshot':
            data = this.terminalSnapshot(identity, args.itemId);
            break;
          case 'terminalCommand':
            data = this.authorized(identity, true, (ctx) => {
              let input;
              try {
                input = terminalCommand(args.name, args.input);
              } catch {
                throw new DomainError(
                  'ATTRIBUTE_VALIDATION_FAILED',
                  '操作参数无效，终端仅支持单件操作。',
                );
              }
              requireFact(input, 'FORBIDDEN', '终端不支持此操作。');
              const replay = this.db.query(
                'SELECT 1 FROM operations WHERE household_id=?1 AND actor_id=?2 AND idempotency_key=?3',
                [ctx.household_id, ctx.actor_id, input.idempotency_key],
              ).rowCount;
              if (!replay) {
                const id = 'item_id' in input ? input.item_id : input.item_ids[0];
                requireFact(
                  !terminalSnapshot(ctx, id).items[0].is_container,
                  'FORBIDDEN',
                  '请在电脑上管理容器。',
                );
              }
              return execute(ctx, args.name as TerminalCommand, input);
            });
            break;
          case 'operation':
            data = this.authorized(identity, false, (ctx) => {
              requireFact(
                typeof args.key === 'string' && args.key.length <= 200,
                'ATTRIBUTE_VALIDATION_FAILED',
                'Invalid operation key.',
              );
              const result = this.db.query(
                'SELECT result,result_payload FROM operations WHERE household_id=?1 AND actor_id=?2 AND idempotency_key=?3',
                [ctx.household_id, ctx.actor_id, args.key],
              ).rows[0]?.result;
              return result ? { status: 'committed', result } : { status: 'unknown' };
            });
            break;
          default:
            throw new DomainError('NOT_FOUND', 'Unknown household method.');
        }
        return JSON.stringify({ data, trace: traceMetadata() });
      } catch (error) {
        if (error instanceof DomainError)
          return JSON.stringify({
            error: { code: error.code, message: error.message, details: error.details },
            trace: traceMetadata(),
          });
        throw error;
      }
    });
  }
  accountTask(
    input: HouseholdTask,
  ):
    | { value: AccountResult; error?: never }
    | { error: { code: string; message: string }; value?: never } {
    try {
      return { value: householdTask(this.db, input) };
    } catch (error) {
      if (error instanceof DomainError)
        return { error: { code: error.code, message: error.message } };
      throw error;
    }
  }
  accountMembers(identity: HouseholdIdentity): {
    members: { id: string }[];
    invitations: { id: string; expires_at: string; revoked: boolean; used_by: string | null }[];
  } {
    return this.authorized(identity, false, (ctx) => ({
      members: this.db.query(
        'SELECT user_id AS id FROM household_members WHERE household_id=?1 ORDER BY joined_at,id',
        [ctx.household_id],
      ).rows,
      invitations: this.db.query(
        'SELECT id,expires_at,revoked,used_by FROM household_invitations WHERE household_id=?1 AND expires_at>?2 ORDER BY created_at DESC',
        [ctx.household_id, new Date().toISOString()],
      ).rows,
    }));
  }
  invitation(householdId: string, tokenHash: string): { name: string } | null {
    const state = this.db.query('SELECT * FROM cf_store_state WHERE singleton=1').rows[0];
    if (state?.household_id !== householdId || state.status !== 'ACTIVE') return null;
    return (
      this.db.query(
        'SELECT h.name FROM household_invitations i JOIN households h ON h.id=i.household_id WHERE i.token_hash=?1 AND i.household_id=?2 AND i.expires_at>?3 AND i.revoked=0 AND i.used_by IS NULL',
        [tokenHash, householdId, new Date().toISOString()],
      ).rows[0] ?? null
    );
  }
  directoryEvents() {
    return this.db
      .query<{ id: string; payload: string }>(
        "SELECT id,payload FROM cf_outbox WHERE kind='DIRECTORY_PROJECT' AND delivered_at IS NULL ORDER BY created_at,id LIMIT 100",
      )
      .rows.map((row) => JSON.parse(row.payload) as DirectoryEvent);
  }
  acknowledgeDirectory(id: string) {
    this.db.query(
      "UPDATE cf_outbox SET delivered_at=(SELECT now FROM cf_clock) WHERE id=?1 AND kind='DIRECTORY_PROJECT'",
      [id],
    );
  }
  command(identity: HouseholdIdentity, name: Operation, input: unknown) {
    return this.authorized(identity, !reads.has(name) && !fileReads.has(name as any), (ctx) =>
      execute(ctx, name, input),
    );
  }
  review(identity: HouseholdIdentity, scope: string, input: unknown) {
    return this.authorized(identity, true, (ctx) => reviewCatalogProposal(ctx, scope, input));
  }
  confirm(identity: HouseholdIdentity, scope: string, input: unknown) {
    return this.authorized(identity, true, (ctx) => confirmCatalogProposal(ctx, scope, input));
  }
  terminalSnapshot(identity: HouseholdIdentity, itemId?: string) {
    return this.authorized(identity, false, (ctx) => terminalSnapshot(ctx, itemId));
  }
  snapshot(identity: HouseholdIdentity) {
    return this.authorized(identity, false, webSnapshotV2);
  }
  synchronize(
    identity: HouseholdIdentity,
    name: 'state' | 'changes' | 'bootstrap' | 'fetch',
    input: unknown,
  ) {
    return this.authorized(identity, false, (ctx) =>
      name === 'state'
        ? syncState(ctx)
        : name === 'changes'
          ? syncChanges(ctx, input)
          : name === 'bootstrap'
            ? syncBootstrap(ctx, input)
            : syncFetch(ctx, input),
    );
  }
  beginUpload(
    identity: HouseholdIdentity,
    id: string,
    ticket: string,
    size: number,
    sha256: string,
  ) {
    return this.authorized(identity, true, (ctx) => beginUpload(ctx, id, ticket, size, sha256));
  }
  confirmUpload(identity: HouseholdIdentity, id: string, lease: string, meta: UploadedMetadata) {
    return this.authorized(identity, true, (ctx) => confirmUpload(ctx, id, lease, meta));
  }
  downloadMetadata(
    identity: HouseholdIdentity,
    id: string,
    variant: string | undefined,
    reveal: boolean,
  ) {
    return this.authorized(identity, false, (ctx) => downloadMetadata(ctx, id, variant, reveal));
  }
  create(input: {
    household_id: string;
    user_id: string;
    actor_id: string;
    membership_id: string;
    name: string;
    actor_name: string;
    timezone: string;
    operation_id: string;
  }) {
    return this.db.transaction(() => {
      const prior = this.db.query('SELECT * FROM cf_store_state WHERE singleton=1').rows[0];
      if (prior) {
        const task = this.db.query('SELECT payload FROM cf_outbox WHERE id=?1', [
          input.operation_id,
        ]).rows[0];
        requireFact(
          task &&
            JSON.parse(task.payload).user_id === input.user_id &&
            prior.household_id === input.household_id,
          'STATE_CONFLICT',
          'Household already exists.',
        );
        return { household_id: input.household_id, actor_id: input.actor_id };
      }
      new Intl.DateTimeFormat('en', { timeZone: input.timezone });
      const hh = input.household_id,
        actor = input.actor_id,
        container = 'catalog_node_' + crypto.randomUUID(),
        now = new Date().toISOString();
      this.db.query('INSERT INTO households(id,name,timezone) VALUES(?1,?2,?3)', [
        hh,
        input.name,
        input.timezone,
      ]);
      this.db.query('INSERT INTO actors(id,household_id,name) VALUES(?1,?2,?3)', [
        actor,
        hh,
        input.actor_name,
      ]);
      this.db.query(
        'INSERT INTO household_members(id,user_id,household_id,actor_id) VALUES(?1,?2,?3,?4)',
        [input.membership_id, input.user_id, hh, actor],
      );
      for (const name of Object.keys(templates) as TemplateId[])
        for (let version = 1; version <= latestTemplateVersion(name); version++)
          publishTemplate(this.db, hh, templateDefinition(name, version));
      this.db.query(
        "INSERT INTO catalog_nodes(id,household_id,kind,name,attributes) VALUES(?1,?2,'SKU','通用容器',?3)",
        [
          container,
          hh,
          [
            {
              template_id: 'catalog',
              template_version: 1,
              values: { visibility: 'HIDDEN' },
              created_at: now,
              updated_at: now,
            },
          ],
        ],
      );
      this.db.query(
        'INSERT INTO household_settings(household_id,container_catalog_id) VALUES(?1,?2)',
        [hh, container],
      );
      this.db.query(
        'INSERT INTO household_sync_state(household_id,sync_generation) VALUES(?1,?2)',
        [hh, crypto.randomUUID()],
      );
      this.db.query(
        "INSERT INTO cf_store_state(singleton,household_id,schema_version,status) VALUES(1,?1,1,'ACTIVE')",
        [hh],
      );
      this.db.query("INSERT INTO cf_outbox(id,kind,payload) VALUES(?1,'DIRECTORY_CREATE',?2)", [
        input.operation_id,
        JSON.stringify(input),
      ]);
      directoryEvent(this.db, input.operation_id + ':directory', hh);
      return { household_id: hh, actor_id: actor };
    });
  }
}
