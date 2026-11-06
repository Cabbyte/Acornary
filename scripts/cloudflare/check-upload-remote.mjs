// Repeated maximum-size transfers on disposable resources, never a production account.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { httpAcceptance } from '../../tests/cloudflare/http-acceptance.mjs';
const root = resolve('.local/cf-native-acceptance'),
  state = JSON.parse(await readFile(root + '/state.json', 'utf8'));
assert.match(state.name, /^acornary-cf-accept-[a-f0-9]{8}$/);
assert.ok(state.deployed && !state.cleaned_at);
assert.equal(state.origin, `https://${state.name}.litang0617.workers.dev`);
const origin = state.origin,
  proxy = await getPlatformProxy({
    configPath: root + '/operator.json',
    envFiles: [],
    remoteBindings: true,
    persist: false,
  });
const report = {
  origin,
  started_at: new Date().toISOString(),
  status: 'RUNNING',
  uploads: [],
  download_interruptions: [],
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
try {
  const dispatchFetch = (url, options) => {
    const h = new Headers(options?.headers);
    h.delete('cf-connecting-ip');
    return fetch(url, {
      ...options,
      headers: h,
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000),
    });
  };
  const helpers = httpAcceptance({ origin, db: proxy.env.AUTH_DB, mf: { dispatchFetch } }),
    a = await helpers.fixture(),
    inv = await helpers.inventory(a);
  const pdf = Buffer.alloc(25 * 1024 * 1024, 65);
  pdf.write('%PDF-1.7\n');
  const jpeg = Buffer.alloc(25 * 1024 * 1024, 1);
  const exif = Buffer.from('Exif\0\0synthetic-private-metadata'),
    app1 = Buffer.alloc(4 + exif.length);
  app1[0] = 255;
  app1[1] = 225;
  app1.writeUInt16BE(exif.length + 2, 2);
  exif.copy(app1, 4);
  const sof = Buffer.from([255, 192, 0, 17, 8, 0, 2, 0, 3, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0]),
    sos = Buffer.from([255, 218, 0, 12, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0]);
  const prefix = Buffer.concat([Buffer.from([255, 216]), app1, sof, sos]);
  prefix.copy(jpeg);
  jpeg[jpeg.length - 2] = 255;
  jpeg[jpeg.length - 1] = 217;
  const sanitized = Buffer.concat([jpeg.subarray(0, 2), jpeg.subarray(2 + app1.length)]);
  async function send(bytes, label, expected = bytes) {
    const reserved = await inv.run('create_attachment_upload', {
      idempotency_key: crypto.randomUUID(),
      filename: label + (label.includes('jpeg') ? '.jpg' : '.pdf'),
      mime_type: label.includes('jpeg') ? 'image/jpeg' : 'application/pdf',
      target: { kind: 'ITEM', id: inv.item },
      file_size: bytes.length,
      sha256: sha(bytes),
    });
    assert.equal(reserved.status, 200, 'reserve ' + label);
    const h = new Headers(inv.headers);
    for (const [k, v] of Object.entries(reserved.data.headers)) h.set(k, v);
    h.set('origin', origin);
    h.set('cookie', a.cookie);
    const start = Date.now(),
      r = await fetch(origin + reserved.data.upload_url, {
        method: 'PUT',
        headers: h,
        body: bytes,
        signal: AbortSignal.timeout(120_000),
      });
    const entry = {
      label,
      bytes: bytes.length,
      status: r.status,
      ray: r.headers.get('cf-ray'),
      request_id: r.headers.get('x-request-id'),
      wall_ms: Date.now() - start,
    };
    report.uploads.push(entry);
    if (r.status !== 200) {
      const body = await r.text();
      entry.cloudflare_error = body.match(/cf-error-code[^>]*>(\d+)/)?.[1];
      throw new Error('Upload failed: ' + JSON.stringify(entry));
    }
    assert.deepEqual(await r.json(), { uploaded: true });
    console.log('PASS ' + label + ' upload');
    return { reserved: reserved.data, h, expected, label };
  }
  async function confirm(result) {
    const current = await inv.run('get_item', { item_id: inv.item });
    assert.equal(current.status, 200);
    const complete = await inv.run('complete_attachment_upload', {
      idempotency_key: crypto.randomUUID(),
      upload_id: result.reserved.upload_id,
      target: { kind: 'ITEM', id: inv.item },
      expected_revisions: { [inv.item]: current.data.revision },
    });
    assert.equal(complete.status, 200, 'confirm ' + result.label);
    let bytes;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(origin + '/api/attachments/' + complete.data.attachment.id, {
          headers: { ...inv.headers, cookie: a.cookie },
          signal: AbortSignal.timeout(120_000),
        });
        assert.equal(r.status, 200);
        bytes = Buffer.from(await r.arrayBuffer());
        break;
      } catch (error) {
        // Only an interrupted read-only download can be retried. Never mask HTTP,
        // checksum, upload, or confirmation failures as transient network errors.
        const code = error.cause?.code ?? error.name;
        if (!['UND_ERR_SOCKET', 'ECONNRESET', 'TimeoutError'].includes(code)) throw error;
        report.download_interruptions.push({ label: result.label, attempt, code });
        if (attempt === 3) throw error;
      }
    }
    assert.equal(bytes.length, result.expected.length);
    assert.equal(sha(bytes), sha(result.expected));
    if (result.label.includes('jpeg')) {
      assert.equal(bytes.includes(exif), false);
      assert.equal(complete.data.attachment.width, 3);
      assert.equal(complete.data.attachment.height, 2);
    }
    console.log('PASS ' + result.label + ' confirmation and byte verification');
  }
  await confirm(await send(pdf.subarray(0, 1024 * 1024), 'pdf-1MiB'));
  for (let i = 1; i <= 3; i++) await confirm(await send(pdf, 'pdf-25MiB-repeat-' + i));
  const pair = await Promise.all([
    send(pdf, 'pdf-25MiB-parallel-1'),
    send(pdf, 'pdf-25MiB-parallel-2'),
  ]);
  for (const r of pair) await confirm(r);
  await confirm(await send(jpeg, 'jpeg-25MiB-exif', sanitized));
  // A replay still re-reads and validates its original bytes before returning the existing result.
  const replay = await fetch(origin + pair[0].reserved.upload_url, {
    method: 'PUT',
    headers: pair[0].h,
    body: pdf,
    signal: AbortSignal.timeout(120_000),
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { uploaded: true });
  report.status = 'PASS';
  report.replay = 'PASS';
  report.verified_bytes = report.uploads.reduce((n, x) => n + x.bytes, 0);
} catch (error) {
  report.status = 'FAIL';
  report.failed_after = report.uploads.length;
  throw error;
} finally {
  report.completed_at = new Date().toISOString();
  await writeFile(root + '/upload-report.json', JSON.stringify(report, null, 2), { mode: 0o600 });
  await proxy.dispose();
}
