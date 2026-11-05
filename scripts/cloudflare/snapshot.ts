import pg from 'pg';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { exportSnapshot } from './migration/export.js';
import { verifySnapshot } from './migration/verify.js';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string' },
    'attachments-root': { type: 'string' },
    'source-commit': { type: 'string' },
    mode: { type: 'string', default: 'preview' },
    'expected-sha256': { type: 'string' },
  },
});
if (!values.output || positionals.length !== 1)
  throw new Error('Usage: snapshot.ts export|verify --output PATH');
if (positionals[0] === 'verify') {
  console.log(
    JSON.stringify(await verifySnapshot(resolve(values.output), values['expected-sha256'])),
  );
} else if (positionals[0] === 'export') {
  if (
    !values['source-commit'] ||
    !values['attachments-root'] ||
    !process.env.ACORNARY_MIGRATION_DATABASE_URL ||
    !['preview', 'production'].includes(values.mode!)
  )
    throw new Error(
      'Export requires ACORNARY_MIGRATION_DATABASE_URL, --source-commit, --attachments-root and a valid --mode',
    );
  const pool = new pg.Pool({
    connectionString: process.env.ACORNARY_MIGRATION_DATABASE_URL,
    max: 1,
  });
  try {
    console.log(
      JSON.stringify(
        await exportSnapshot(pool, {
          output: resolve(values.output),
          attachmentsRoot: resolve(values['attachments-root']),
          sourceCommit: values['source-commit'],
          mode: values.mode as 'preview' | 'production',
        }),
      ),
    );
  } finally {
    await pool.end();
  }
} else throw new Error('Expected export or verify');
