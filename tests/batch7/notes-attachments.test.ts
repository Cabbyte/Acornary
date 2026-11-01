import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute, type Context } from '../../apps/server/src/service.js';
import { createHousehold } from '../../apps/server/src/initialize.js';
import { pool, query, transaction } from '../../apps/server/src/db.js';
import { buildApp } from '../../apps/server/src/app.js';
import {
  cleanupAttachments,
  downloadAttachment,
  LocalBlobStore,
  putAttachment,
  sniffMime,
  MAX_FILE_SIZE,
  PassthroughMediaProcessor,
} from '../../apps/server/src/attachments.js';
import { redactFor } from '../../apps/server/src/redaction.js';
import type { Operation } from '../../packages/contracts/src/index.js';

const pdf = Buffer.from('%PDF-1.7\nprivate content\n%%EOF');
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
let ctx: Context, item: string, sku: string, root: string, blobs: LocalBlobStore;
const target = () => ({ kind: 'ITEM', id: item });
const write = (name: Operation, args: any) =>
  execute(ctx, name, { idempotency_key: randomUUID(), ...args });
const revision = async (id = item, kind = 'items') =>
  (await query(pool, `SELECT revision FROM ${kind} WHERE id=$1`, [id])).rows[0].revision;
const ticket = (bytes = pdf, extra: any = {}) =>
  write('create_attachment_upload', {
    target: target(),
    filename: 'untrusted.png',
    mime_type: 'image/png',
    file_size: bytes.length,
    ...extra,
  });
const upload = async (bytes = pdf, extra: any = {}) => {
  const t = await ticket(bytes, extra);
  await putAttachment(ctx, t.upload_id, t.headers['X-Acornary-Upload-Ticket'], bytes, blobs);
  return t;
};
const complete = async (t: any, extra: any = {}) =>
  write('complete_attachment_upload', {
    upload_id: t.upload_id,
    target: target(),
    expected_revisions: { [item]: await revision() },
    ...extra,
  });

describe.skipIf(!process.env.DATABASE_URL)('Batch 7 real PostgreSQL and private temp blobs', () => {
  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL!).pathname !== '/acornary_test_w2_files')
      throw Error('Requires dedicated batch7 database.');
    root = await mkdtemp(join(tmpdir(), 'acornary-batch7-'));
    process.env.ACORNARY_ATTACHMENT_ROOT = root;
    process.env.LOG_LEVEL = 'silent';
    blobs = new LocalBlobStore(root);
  });
  beforeEach(async () => {
    const h = await transaction((c) => createHousehold(c, 'batch7'));
    ctx = { ...h, source: 'TEST' };
    sku = h.container_catalog_id;
    item = (await write('create_items', { catalog_node_id: sku, count: 1 })).affected_objects[0].id;
  });
  afterAll(async () => {
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });

  it('MODEL12 expands targets, retains IDs, attributes, summaries and updated_by; archives and restores', async () => {
    const a = await write('add_note', {
      target: target(),
      body: '😀'.repeat(200),
      expected_revisions: { [item]: 1 },
    });
    expect(Array.from(a.note.excerpt)).toHaveLength(160);
    expect(a.note).not.toHaveProperty('body');
    expect(a.affected_objects[0].after_revision).toBe(2);
    const actor = 'actor_' + randomUUID();
    await query(pool, 'INSERT INTO actors(id,household_id,name) VALUES($1,$2,$3)', [
      actor,
      ctx.household_id,
      'editor',
    ]);
    const update = {
      note_id: a.note_id,
      body: 'edited',
      expected_revisions: { [item]: 2 },
      idempotency_key: randomUUID(),
    };
    const b = await execute({ ...ctx, actor_id: actor }, 'update_note', update);
    expect(b.note.updated_by).toBe(actor);
    expect(b.note.id).toBe(a.note_id);
    expect(await execute({ ...ctx, actor_id: actor }, 'update_note', update)).toEqual(b);
    expect((await execute(ctx, 'get_item', { item_id: item })).notes[0]).not.toHaveProperty('body');
    expect((await execute(ctx, 'get_note', { note_id: a.note_id })).body).toBe('edited');
    const archived = await write('archive_note', {
      note_id: a.note_id,
      archived: true,
      expected_revisions: { [item]: 3 },
    });
    expect(archived.note.archived).toBe(true);
    expect((await execute(ctx, 'list_notes', { target: target() })).data).toEqual([]);
    expect(
      (await execute(ctx, 'list_notes', { target: target(), include_archived: true })).data,
    ).toHaveLength(1);
    await write('archive_note', {
      note_id: a.note_id,
      archived: false,
      expected_revisions: { [item]: 4 },
    });
    const catalog = await write('add_note', {
      target: { kind: 'CATALOG_NODE', id: sku },
      body: 'catalog',
      expected_revisions: { [sku]: 1 },
    });
    expect(catalog.affected_objects[0]).toMatchObject({
      kind: 'CATALOG_NODE',
      id: sku,
      after_revision: 2,
    });
    expect(
      (await query(pool, 'SELECT item_id FROM notes WHERE id=$1', [catalog.note_id])).rows[0]
        .item_id,
    ).toBeNull();
    const before = (await query(pool, 'SELECT attributes FROM items WHERE id=$1', [item])).rows[0];
    await write('edit_item', {
      item_id: item,
      display_name: 'updated',
      note: { note_id: a.note_id, body: 'combined' },
      expected_revisions: { [item]: 5 },
    });
    expect(await revision()).toBe(6);
    expect((await query(pool, 'SELECT attributes FROM items WHERE id=$1', [item])).rows[0]).toEqual(
      before,
    );
    expect((await execute(ctx, 'get_note', { note_id: a.note_id })).body).toBe('combined');
  });

  it('MODEL12 same-value writes do not increment revisions; wrong target, stale revision and household fail atomically', async () => {
    const note = await write('add_note', {
      item_id: item,
      body: 'same',
      expected_revisions: { [item]: 1 },
    });
    expect(
      (
        await write('update_note', {
          note_id: note.note_id,
          body: 'same',
          expected_revisions: { [item]: 2 },
        })
      ).changed,
    ).toBe(false);
    await expect(
      write('update_note', {
        note_id: note.note_id,
        body: 'bad',
        expected_revisions: { [item]: 1 },
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(
      write('update_note', {
        note_id: note.note_id,
        target: { kind: 'CATALOG_NODE', id: sku },
        body: 'bad',
        expected_revisions: { [item]: 2 },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const other = await transaction((c) => createHousehold(c));
    await expect(
      execute({ ...other, source: 'TEST' }, 'get_note', { note_id: note.note_id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await revision()).toBe(2);
  });

  it('MODEL12 migrates legacy notes losslessly without rewriting history', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('CREATE SCHEMA legacy_note_fixture');
      await c.query('SET LOCAL search_path=legacy_note_fixture,pg_catalog');
      await c.query(
        'CREATE TABLE households(id text PRIMARY KEY); CREATE TABLE actors(household_id text,id text,PRIMARY KEY(household_id,id)); CREATE TABLE items(household_id text,id text,PRIMARY KEY(household_id,id)); CREATE TABLE catalog_nodes(household_id text,id text,PRIMARY KEY(household_id,id)); CREATE TABLE notes(id text PRIMARY KEY,household_id text,item_id text NOT NULL,title text,body text,body_format text,created_by text,created_at timestamptz,updated_at timestamptz)',
      );
      await c.query(
        "CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$",
      );
      await c.query(
        "INSERT INTO households VALUES('h'); INSERT INTO actors VALUES('h','a'); INSERT INTO items VALUES('h','i'); INSERT INTO notes VALUES('old','h','i','title','exact body','Markdown','a','2020-01-01','2021-01-01')",
      );
      const old = (await c.query('SELECT * FROM notes')).rows[0];
      await c.query(
        await readFile(
          new URL('../../migrations/016_notes_attachments.sql', import.meta.url),
          'utf8',
        ),
      );
      expect((await c.query('SELECT * FROM notes')).rows[0]).toMatchObject({
        ...old,
        target_kind: 'ITEM',
        target_id: 'i',
        updated_by: 'a',
        sensitivity: 'NORMAL',
        archived_at: null,
      });
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('FILE01 sniffs bytes, rejects SVG/HTML, and serves PDF with private download headers', async () => {
    for (const bytes of [Buffer.from('<svg></svg>'), Buffer.from('<html>bad</html>')]) {
      const t = await ticket(bytes);
      await expect(
        putAttachment(ctx, t.upload_id, t.headers['X-Acornary-Upload-Ticket'], bytes, blobs),
      ).rejects.toMatchObject({ code: 'ATTACHMENT_TYPE_UNSUPPORTED' });
    }
    const t = await upload();
    const done = await complete(t);
    expect(done.attachment.mime_type).toBe('application/pdf');
    const d = await downloadAttachment(ctx, done.attachment.id, undefined, false, blobs);
    expect(d.bytes).toEqual(pdf);
    expect(d.headers).toMatchObject({
      'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    expect(sniffMime(png)).toBe('image/png');
    expect(sniffMime(Buffer.from([255, 216, 255]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('RIFF1234WEBP'))).toBe('image/webp');
    const b = (
      await query(pool, 'SELECT * FROM attachment_blobs WHERE household_id=$1', [ctx.household_id])
    ).rows[0];
    expect(b.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(b.storage_key).toMatch(/^[a-f0-9]{64}$/);
    expect((await stat(join(root, b.storage_key + '.blob'))).mode & 0o777).toBe(0o600);
    expect(done.attachment).not.toHaveProperty('storage_key');
  });

  it('FILE02 safe default reports no EXIF stripping, no dimensions and no thumbnail', async () => {
    const media = await new PassthroughMediaProcessor().process(png);
    expect(media).toMatchObject({ bytes: png, exifStripped: false, width: null, height: null });
    const done = await complete(await upload(png));
    expect(done.attachment).toMatchObject({ width: null, height: null, thumbnail_url: null });
    await expect(
      downloadAttachment(ctx, done.attachment.id, 'thumb', false, blobs),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('FILE03 enforces file size and concurrent target reservations', async () => {
    await expect(ticket(pdf, { file_size: MAX_FILE_SIZE + 1 })).rejects.toMatchObject({
      code: 'ATTACHMENT_TOO_LARGE',
    });
    const attempts = await Promise.allSettled(Array.from({ length: 21 }, () => ticket()));
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(20);
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await query(
      pool,
      "UPDATE upload_sessions SET expires_at=now()-interval '1 minute' WHERE household_id=$1",
      [ctx.household_id],
    );
    await expect(ticket()).resolves.toHaveProperty('upload_id');
  });

  it('FILE03 household quota counts concurrent reserved bytes across targets and warns at 80%', async () => {
    // Metadata-only fixture for 5 GiB minus one 25 MiB slot; no large buffers or network.
    await query(
      pool,
      `INSERT INTO attachment_blobs(id,household_id,storage_key,mime_type,file_size,sha256)
      SELECT 'quota-'||$1||'-'||n,$1,md5($1||n::text)||md5(n::text||$1),'application/pdf',26214400,repeat('a',64) FROM generate_series(1,203) n`,
      [ctx.household_id],
    );
    const attempts = await Promise.allSettled([
      ticket(pdf, { file_size: MAX_FILE_SIZE }),
      ticket(pdf, { file_size: MAX_FILE_SIZE }),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (attempts.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value
        .quota_warning,
    ).toBe(true);
    expect(
      (attempts.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code,
    ).toBe('ATTACHMENT_QUOTA_EXCEEDED');
  });

  it('FILE04 confirms idempotently, rejects stale revisions without links/events and binds ticket to actor, target, size, checksum and expiry', async () => {
    const t = await upload();
    const bad = { upload_id: t.upload_id, target: target(), expected_revisions: { [item]: 99 } };
    await expect(write('complete_attachment_upload', bad)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    expect(
      (await query(pool, 'SELECT * FROM attachments WHERE household_id=$1', [ctx.household_id]))
        .rows,
    ).toEqual([]);
    const args = { ...bad, expected_revisions: { [item]: 1 }, idempotency_key: randomUUID() };
    const done = await execute(ctx, 'complete_attachment_upload', args);
    expect(await execute(ctx, 'complete_attachment_upload', args)).toEqual(done);
    expect((await complete(t)).attachment.id).toBe(done.attachment.id);
    expect(await revision()).toBe(2);
    expect(
      (
        await query(
          pool,
          "SELECT * FROM events WHERE household_id=$1 AND event_type='ATTACHMENT_ATTACH'",
          [ctx.household_id],
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      putAttachment(ctx, t.upload_id, t.headers['X-Acornary-Upload-Ticket'], pdf, blobs),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const pending = await ticket();
    await expect(putAttachment(ctx, pending.upload_id, 'wrong', pdf, blobs)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      putAttachment(
        ctx,
        pending.upload_id,
        pending.headers['X-Acornary-Upload-Ticket'],
        Buffer.from('short'),
        blobs,
      ),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    const mismatch = await ticket(pdf, { sha256: '0'.repeat(64) });
    await expect(
      putAttachment(
        ctx,
        mismatch.upload_id,
        mismatch.headers['X-Acornary-Upload-Ticket'],
        pdf,
        blobs,
      ),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    await query(
      pool,
      "UPDATE upload_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
      [pending.upload_id],
    );
    await expect(
      putAttachment(
        ctx,
        pending.upload_id,
        pending.headers['X-Acornary-Upload-Ticket'],
        pdf,
        blobs,
      ),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('FILE04 note attachment updates its owner, catalog attachment updates catalog, and detach is soft', async () => {
    const note = await write('add_note', {
      target: target(),
      body: 'note',
      expected_revisions: { [item]: 1 },
    });
    const noteTarget = { kind: 'NOTE', id: note.note_id };
    const t = await upload(pdf, { target: noteTarget });
    const done = await complete(t, { target: noteTarget });
    expect(done.affected_objects[0].id).toBe(item);
    const catTarget = { kind: 'CATALOG_NODE', id: sku };
    const cat = await upload(pdf, { target: catTarget });
    expect(
      (await complete(cat, { target: catTarget, expected_revisions: { [sku]: 1 } }))
        .affected_objects[0].id,
    ).toBe(sku);
    await write('detach_attachment', {
      attachment_id: done.attachment.id,
      expected_revisions: { [item]: 3 },
    });
    expect((await execute(ctx, 'list_attachments', { target: noteTarget })).data).toEqual([]);
    await expect(
      downloadAttachment(ctx, done.attachment.id, undefined, false, blobs),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      (await query(pool, 'SELECT detached_at FROM attachments WHERE id=$1', [done.attachment.id]))
        .rows[0].detached_at,
    ).not.toBeNull();
  });

  it('FILE05 cleans unlinked uploads after 24h and detached blobs after 30d; lease guard can defer deletion', async () => {
    const pending = await upload();
    const done = await complete(await upload());
    await write('detach_attachment', {
      attachment_id: done.attachment.id,
      expected_revisions: { [item]: 2 },
    });
    expect(await cleanupAttachments(ctx, blobs)).toEqual({ removed: 0 });
    await query(
      pool,
      "UPDATE upload_sessions SET created_at=now()-interval '25 hours' WHERE id=$1",
      [pending.upload_id],
    );
    await query(
      pool,
      "UPDATE attachment_blobs SET detached_at=now()-interval '31 days' WHERE household_id=$1 AND detached_at IS NOT NULL",
      [ctx.household_id],
    );
    expect(
      await cleanupAttachments(ctx, blobs, { withDeletionLease: async () => undefined }),
    ).toEqual({ removed: 0 });
    expect(
      await cleanupAttachments(ctx, blobs, {
        withDeletionLease: async (_h, _keys, remove) => remove(),
      }),
    ).toEqual({ removed: 2 });
    expect(await cleanupAttachments(ctx, blobs)).toEqual({ removed: 0 });
  });

  it('FILE06/07 central metadata-driven redaction and audited reveal keep base summaries clean', async () => {
    const note = await write('add_note', {
      target: target(),
      title: 'secret title',
      body: 'secret body',
      sensitivity: 'SECRET',
      expected_revisions: { [item]: 1 },
    });
    for (const data of [
      note,
      await execute(ctx, 'list_notes', {}),
      await execute(ctx, 'get_note', { note_id: note.note_id }),
      await execute(ctx, 'get_item', { item_id: item }),
    ]) {
      expect(JSON.stringify(data)).not.toContain('secret body');
      expect(JSON.stringify(data)).not.toContain('secret title');
    }
    const before = await revision();
    expect(
      (await execute(ctx, 'get_note', { note_id: note.note_id, reveal_sensitive: true })).body,
    ).toBe('secret body');
    expect(await revision()).toBe(before);
    expect(
      (
        await query(pool, 'SELECT * FROM sensitive_access_audit WHERE household_id=$1', [
          ctx.household_id,
        ])
      ).rows,
    ).toHaveLength(1);
    expect((await execute(ctx, 'get_note', { note_id: note.note_id })).body).toBeUndefined();
    const value = { fields: { serial: 'secret', ordinary: 'ok' } };
    for (const scope of [
      'list',
      'summary',
      'detail',
      'sync',
      'history',
      'receipt',
      'inspect',
      'export',
      'error',
      'log',
    ] as const)
      expect(redactFor(scope, value, { 'fields.serial': 'SECRET' })).toMatchObject({
        fields: { ordinary: 'ok' },
        redacted_paths: ['fields.serial'],
      });
    expect(value.fields.serial).toBe('secret');
    expect(() =>
      redactFor({ scope: 'detail', audit: {} }, value, { 'fields.serial': 'SECRET' }),
    ).toThrow();
    const t = await upload(pdf, { target: { kind: 'NOTE', id: note.note_id } });
    const done = await complete(t, {
      target: { kind: 'NOTE', id: note.note_id },
      caption: 'private caption',
    });
    expect(done.attachment.caption).toBeUndefined();
    await expect(
      downloadAttachment(ctx, done.attachment.id, undefined, false, blobs),
    ).rejects.toMatchObject({ code: 'REVEAL_AUDIT_REQUIRED' });
    expect(
      (await downloadAttachment(ctx, done.attachment.id, undefined, true, blobs)).bytes,
    ).toEqual(pdf);
    expect(
      (
        await query(pool, 'SELECT * FROM sensitive_access_audit WHERE household_id=$1', [
          ctx.household_id,
        ])
      ).rows,
    ).toHaveLength(2);
  });

  it('FILE08 HTTP binary channel authenticates, enforces CSRF/protocol and keeps ticket out of URL; no network', async () => {
    const app = await buildApp(ctx, 'test-token', false);
    try {
      const t = await ticket();
      expect(t.upload_url).not.toContain(t.headers['X-Acornary-Upload-Ticket']);
      const headers = {
        ...t.headers,
        authorization: 'Bearer test-token',
        origin: 'http://localhost:80',
      };
      expect(
        (await app.inject({ method: 'PUT', url: t.upload_url, headers: t.headers, payload: pdf }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: t.upload_url,
            headers: { ...headers, origin: 'http://evil.invalid' },
            payload: pdf,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: 'PUT', url: t.upload_url, headers, payload: pdf })).statusCode,
      ).toBe(200);
      const done = await complete(t);
      const url = '/api/attachments/' + done.attachment.id;
      expect((await app.inject({ url })).statusCode).toBe(401);
      const response = await app.inject({
        url,
        headers: { authorization: 'Bearer test-token', 'x-acornary-protocol': '2' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(pdf);
      expect(response.headers['content-disposition']).toBe('attachment');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      await expect(
        execute({ ...ctx, source: 'MCP' }, 'create_attachment_upload', {
          target: target(),
          filename: 'x',
          mime_type: 'image/png',
          file_size: 12,
          idempotency_key: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await app.close();
    }
  });

  it('FILE06/08 re-redacts receipts after classification changes and forbids MCP ticket replay', async () => {
    const input = {
      target: target(),
      body: 'formerly public',
      title: 'old title',
      expected_revisions: { [item]: 1 },
      idempotency_key: randomUUID(),
    };
    const note = await execute(ctx, 'add_note', input);
    await write('update_note', {
      note_id: note.note_id,
      body: 'now secret',
      sensitivity: 'SECRET',
      expected_revisions: { [item]: 2 },
    });
    const replay = await execute(ctx, 'add_note', input);
    expect(replay.operation_id).toBe(note.operation_id);
    expect(replay.note.excerpt).toBeUndefined();
    expect(replay.note.title).toBeUndefined();
    const uploadInput = {
      target: target(),
      filename: 'x',
      mime_type: 'image/png',
      file_size: 12,
      idempotency_key: randomUUID(),
    };
    await execute(ctx, 'create_attachment_upload', uploadInput);
    await expect(
      execute({ ...ctx, source: 'MCP' }, 'create_attachment_upload', uploadInput),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('FILE04 failed media processing leaves no blob/link; another actor cannot use the ticket', async () => {
    const t = await ticket();
    await expect(
      putAttachment(ctx, t.upload_id, t.headers['X-Acornary-Upload-Ticket'], pdf, blobs, {
        process: async () => {
          throw Error('processor failure');
        },
      }),
    ).rejects.toThrow('processor failure');
    expect(
      (
        await query(pool, 'SELECT * FROM attachment_blobs WHERE household_id=$1', [
          ctx.household_id,
        ])
      ).rows,
    ).toEqual([]);
    const actor = 'actor_' + randomUUID();
    await query(pool, 'INSERT INTO actors(id,household_id,name) VALUES($1,$2,$3)', [
      actor,
      ctx.household_id,
      'other',
    ]);
    await expect(
      putAttachment(
        { ...ctx, actor_id: actor },
        t.upload_id,
        t.headers['X-Acornary-Upload-Ticket'],
        pdf,
        blobs,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await putAttachment(ctx, t.upload_id, t.headers['X-Acornary-Upload-Ticket'], pdf, blobs);
    expect((await complete(t)).changed).toBe(true);
  });

  it('note pagination binds cursors to household/filter and never returns bodies', async () => {
    await write('add_note', { target: target(), body: 'one', expected_revisions: { [item]: 1 } });
    await write('add_note', { target: target(), body: 'two', expected_revisions: { [item]: 2 } });
    const first = await execute(ctx, 'list_notes', { limit: 1 });
    const second = await execute(ctx, 'list_notes', { limit: 1, cursor: first.next_cursor });
    expect(first.data[0].id).not.toBe(second.data[0].id);
    expect(second.next_cursor).toBeNull();
    await expect(
      execute(ctx, 'list_notes', { limit: 1, include_archived: true, cursor: first.next_cursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
});
