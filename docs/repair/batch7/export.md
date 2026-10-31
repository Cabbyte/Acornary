# Batch 7 — frozen export (QUERY04/QUERY05)

Implemented on `codex/wave5-export`, based on `0c74e1e`. Server scope: **QUERY04 PASS / QUERY05 PASS**. Feature discovery now advertises `frozen_export`. No client download UI or public download link is introduced.

| File | Change |
| --- | --- |
| `migrations/019_frozen_export.sql` | Household/actor metadata, expiry index, frozen JSON rows keyed by household/export/ordinal, cascading release, conditional runtime grants |
| `packages/contracts/src/export.ts` | Request schemas, result types, operation names/descriptions |
| `packages/contracts/src/index.ts` | Minimal schema/read/description and feature registration |
| `apps/server/src/exports.ts` | Snapshot materialization, redaction/audit, signed pagination, expiry/generation checks, cancellation, callable cleanup, export-only HTTP authentication |
| `apps/server/src/service.ts` | Import plus export dispatch to the unchanged query reader (2 lines) |
| `apps/server/src/app.ts` | Import plus export route registration (2 lines) |
| `tests/batch7/export.test.ts` | 12 PostgreSQL/HTTP acceptance tests |
| `docs/repair/batch7/export.md` | Contract, evidence and remaining limits |

Use `POST /api/read/begin_export`, `POST /api/read/read_export`, and `POST /api/read/cancel_export`. All export HTTP requests require protocol 2; local mode requires the existing personal bearer token, cloud mode uses the existing session and current household membership. POST additionally requires the same-origin `Origin`, `X-Acornary-Request: web`, and JSON content type. Existing GET read compatibility is authenticated for export operations as well, including encoded operation names. Responses inherit `Cache-Control: no-store`. Existing non-export read behavior is unchanged. MCP operations use the existing read-scope authentication and service dispatcher.

Example request sequence (all bodies are JSON):

```json
{"kind":"ITEM","query":{"catalog_node_ids":["catalog_node_<uuid>"],"sort":{"field":"name","direction":"asc"}},"include_sensitive":false}
```

`begin_export` returns `export_id`, `generation`, `query_hash`, `disclosure_mode`, `as_of_change_id`, `matching_count`, the existing query `summary`, and `expires_at`. It returns metadata; obtain rows with `read_export`:

```json
{"export_id":"export_<uuid>","kind":"ITEM","query":{"catalog_node_ids":["catalog_node_<uuid>"],"sort":{"field":"name","direction":"asc"}},"include_sensitive":false,"limit":100}
```

Read returns the same metadata plus `data` and `next_cursor`. Repeat the selection/disclosure and pass `cursor: next_cursor` for subsequent pages. `next_cursor: null` means completion. Limit defaults to 100, maximum 200; page size may change. Optional `generation` and `query_hash` on read assert the metadata returned by begin. `kind` is `ITEM` or `CATALOG_NODE`. `query` defaults to `{}` and is validated by the existing kind-specific query schema; nested browse `cursor`/`limit` are rejected. The hash covers parsed/defaulted query fields (including sort and projection options), kind and disclosure. Textual query changes conservatively invalidate even if they happen to match the same rows.

Cancellation body is `{"export_id":"export_<uuid>"}`; result is `{export_id,cancelled}`. Repeated/foreign cancellation returns `cancelled:false` without exposing another actor's export. Reads of missing, expired, cancelled, tampered, cross-household/actor, mismatched-query/disclosure or obsolete-generation exports return `CURSOR_STALE` (HTTP 409). Invalid authenticated actor context remains `FORBIDDEN`; missing HTTP authentication is `UNAUTHORIZED`.

`begin_export` uses one REPEATABLE READ transaction and the existing `readQuery` callback, iterating its 200-row pages without changing its predicates, sorting, cursor internals or summary calculations. The captured watermark, generation, full matching-set summary, and all rows share the transaction snapshot. A household without sync state gets a stable generation and watermark zero; no sync change is emitted. All output rows are persisted before commit. Each later page opens its own transaction and reads only the private projection. Each export has a persisted random HMAC key; signed cursors bind the export, next ordinal, hash, generation and disclosure mode. The key is never returned.

TTL is exactly one hour from transaction start, enforced on every read regardless of cleanup. `cleanupExports(ctx)` authenticates the actor and removes expired exports only in that household. Cancellation releases only the caller's export. Both delete children by foreign-key cascade. There is no background scheduler. Neither projection creation nor read/cancel/cleanup writes inventory rows, operations, events or sync changes.

Default disclosure is `REDACTED`: registry and stored household template declarations marked SENSITIVE or SECRET are omitted through `redactFor('export', ...)` before persistence. `redacted_paths` identifies actual indexed JSON paths, for example `attributes.0.values.serial_no`. Unknown/retired template values are withheld entirely by default. Both begin and every read of a sensitive export require `include_sensitive:true`; that mode is recorded as `SENSITIVE`. Each successful sensitive begin/read inserts an immutable `sensitive_access_audit` entry with target kind `EXPORT`, target ID equal to the export ID, the household/actor, and scope `export`. Audit failure rolls back the operation; default reads cannot disclose a sensitive export.

Validation used the supplied PostgreSQL 18.6 database, without starting Docker/Postgres or running the full suite:

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w5_export ../../node_modules/.bin/tsx apps/server/src/migrate.ts
../../node_modules/.bin/tsc --noEmit
../../node_modules/.bin/tsc -p apps/web/tsconfig.json
```

Migration from the empty database through `019_frozen_export.sql`: **PASS**. Both typechecks: **PASS**. The root Vitest config excludes nested suites; use this external temporary config to reproduce the targeted run:

```sh
cat > /tmp/acornary-wave5-export-vitest.mjs <<'CONFIG'
export default { test: { include: ['tests/batch7/export.test.ts', 'tests/batch2/query-cursors.test.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 } };
CONFIG
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w5_export ../../node_modules/.bin/vitest run --config /tmp/acornary-wave5-export-vitest.mjs
```

Final result: **22 passed, 0 failed** (12 export acceptance tests + 10 unchanged browse cursor regressions).

| Case | Evidence |
| --- | --- |
| QUERY04 | Frozen rows/order/revisions and full-set summary survive update/consume/create; variable page sizes and replay; 209-row materialization with a real committed write between internal pages; item/catalog matching and path parity; empty export without pre-existing sync state; no inventory/event/operation/sync side effects |
| QUERY05 | Tampered/malformed/swapped cursors; wrong kind/filter/sort/hash/disclosure; server generation reset; cross-household and same-household different actor; actor revalidation; exact TTL and household-scoped cascading cleanup/cancellation; declared SENSITIVE/SECRET omission in persisted rows; explicit disclosure audits and audit-failure rollback; authenticated HTTP, encoded-path guard, CSRF and HTTP 409 mapping |

Remaining limits: existing matching semantics are intentionally reused, including legacy search predicates over notes; this lane does not repair sensitivity-based search-membership inference or the repository-wide read-path redaction matrix. Export redaction covers declared attribute paths and conservatively withholds unknown/retired values; it cannot infer secrets placed in otherwise normal free text. Notes/attachments are not separately exported. Large-export performance is unbenchmarked: the existing query recomputes its summary per internal page, and business database timeouts still apply. The callable cleanup needs operational invocation for physical removal after TTL, though expired content is already inaccessible through read_export. Cloud session/membership machinery is reused; a live cloud/OAuth deployment was not exercised here. The installed Node runtime is 26.7.0 while package.json specifies Node 24; Node 24 verification remains an integration check. Fastify emits the existing `disableRequestLogging` deprecation warning. No implementation blockers remain for this lane.
