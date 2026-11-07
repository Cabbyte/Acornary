import { mkdir, readFile, readdir, writeFile, link, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Plugin } from 'vite';
import { z } from 'zod';

const directory = fileURLToPath(new URL('../../../../.local/ui-review-feedback/', import.meta.url));
const input = z
  .object({
    id: z.uuid(),
    component: z.string().regex(/^[a-z0-9-]{1,120}$/),
    name: z.string().min(1).max(200),
    scenario: z.string().min(1).max(120),
    preset: z.enum(['sage', 'apricot', 'berry', 'terracotta']),
    mode: z.enum(['daily', 'management']),
    viewport: z.number().int().min(1).max(10000),
    version: z.string().min(1).max(30),
    text: z.string().trim().min(1).max(8000),
  })
  .strict();

/** Local review metadata only. Never installed in a production Vite configuration. */
export function reviewFeedbackServer(): Plugin {
  return {
    name: 'acornary-local-review-feedback',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__review/feedback', async (req, res) => {
        const reply = (status: number, value: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(value));
        };
        const host = req.headers.host || '';
        if (
          !/^(127\.0\.0\.1|localhost):\d+$/.test(host) ||
          (req.headers.origin && req.headers.origin !== `http://${host}`) ||
          req.headers['sec-fetch-site'] === 'cross-site'
        ) {
          reply(403, { error: '仅允许本机审阅页面访问。' });
          return;
        }
        try {
          await mkdir(directory, { recursive: true });
          if (req.method === 'GET') {
            const files = (await readdir(directory)).filter((f) => /^[\da-f-]{36}\.json$/.test(f));
            const records = await Promise.all(
              files.map(async (f) => JSON.parse(await readFile(join(directory, f), 'utf8'))),
            );
            reply(200, { records: records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
            return;
          }
          if (req.method !== 'POST') {
            reply(405, { error: '不支持此操作。' });
            return;
          }
          if (
            req.headers.origin !== `http://${host}` ||
            !req.headers['content-type']?.startsWith('application/json')
          ) {
            reply(403, { error: '请从本地审阅页面提交。' });
            return;
          }
          let body = '';
          for await (const chunk of req) {
            body += chunk.toString();
            if (Buffer.byteLength(body) > 40000) {
              reply(413, { error: '意见过长，请缩短后提交。' });
              return;
            }
          }
          let parsed;
          try {
            parsed = input.safeParse(JSON.parse(body));
          } catch {
            reply(400, { error: '意见格式无效。' });
            return;
          }
          if (!parsed.success) {
            reply(400, { error: '请检查意见内容与页面信息。' });
            return;
          }
          const data = parsed.data;
          const record = { ...data, createdAt: new Date().toISOString() };
          const destination = join(directory, `${data.id}.json`);
          const temp = join(directory, `${randomUUID()}.tmp`);
          await writeFile(temp, JSON.stringify(record, null, 2) + '\n', {
            flag: 'wx',
            mode: 0o600,
          });
          try {
            // Publish a complete file atomically; identical retries cannot overwrite a comment.
            await link(temp, destination);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const saved = JSON.parse(await readFile(destination, 'utf8'));
            const { createdAt: _time, ...original } = saved;
            if (JSON.stringify(original) !== JSON.stringify(data)) {
              reply(409, { error: '提交编号已用于另一条意见，请刷新记录。' });
              return;
            }
            reply(200, { record: saved });
            return;
          } finally {
            await unlink(temp);
          }
          reply(201, { record });
        } catch {
          reply(500, { error: '本地文件保存失败，原文已保留，请重试。' });
        }
      });
    },
  };
}
