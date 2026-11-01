# Batch 7 backend: notes, private attachments, redaction

Status: backend lane implemented; integration gaps below prevent declaring repository-wide redaction or plugin/media acceptance complete. No feature flags are advertised by this lane. Only the owned files changed; no new dependencies, scheduler, UI, snapshot-v2, query-cursor, registry, deadline or void/split changes.

## Files and migration

- `migrations/016_notes_attachments.sql`: expands notes to ITEM/CATALOG_NODE; preserves IDs, bodies, timestamps and legacy item_id projection; backfills updated_by from created_by; adds archive/sensitivity metadata. Adds attachment_blobs, upload_sessions, attachments and append-only sensitive_access_audit. Household-scoped target guards reject nonexistent/cross-household targets.
- `packages/contracts/src/notes.ts`: note/attachment schemas, targets, sensitivity and DTO types. Minimal registration in `packages/contracts/src/index.ts`. Legacy item_id note input remains supported.
- `apps/server/src/notes.ts`: authenticated transaction/household-lock/idempotency boundary for these commands, revisions/events/sync references, note mutation/summary/detail/list pagination. No note body in these lists or get_item summaries. Same-value edits are no-ops. edit_item reuses the mutation helper atomically.
- `apps/server/src/attachments.ts`: private BlobStore, MediaProcessor interface/default, reservation/upload/confirmation/detach/list/download and callable GC. Local files use opaque server keys, directory 0700, files 0600. Root defaults to `.local/attachments`; override with `ACORNARY_ATTACHMENT_ROOT`.
- `apps/server/src/redaction.ts`: metadata-driven `redactFor(scope,value,sensitivityPaths)`; dotted paths including numeric array indexes. NORMAL is retained; SENSITIVE/SECRET values are omitted and redacted_paths is populated. Audit insertion creates a private in-process capability required for detail reveal. Historical rows are never rewritten.
- `apps/server/src/service.ts`: small dispatch/read-summary hooks and replacement of the edit_item note mutation block; existing inventory save/query logic unchanged.
- `apps/server/src/app.ts`: binary PUT/GET routes, attachment authentication added to the existing cloud session hook, encapsulated binary parser and error handler.
- `tests/batch7/notes-attachments.test.ts`: PostgreSQL, temporary BlobStore and Fastify injection tests.

Migration command applied successfully against the supplied PostgreSQL 18.6 database:

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w2_files ../../node_modules/.bin/tsx apps/server/src/migrate.ts
```

Migration 016 also runs against a transaction-local legacy-note fixture and verifies all old fields remain byte/value-equivalent. Existing event/operation rows are not rewritten.

## Behavior and integration interfaces

Writes require expected_revisions of the owning Item/CatalogNode. Note attachment writes resolve that owner. A target revision increment, event, sync reference and operation receipt commit atomically. Notes do not reserialize target attributes in standalone commands. Receipts contain summaries only; replay reprojects their note/attachment summary with current sensitivity to prevent disclosure after reclassification. Operation/event IDs and write effects retain idempotency. No inventory revision or sync event is generated for reveal audits or upload reservation/PUT.

Upload reservations serialize under the household lock and enforce 25 MiB/file, 20 active links plus live reservations/target, and 5 GiB/household. Blob storage, including detached and uploaded-but-unlinked bytes, counts until GC. A conservative reservation-size charge covers future processed/thumbnail bytes. Responses signal the 80% quota warning. PUT tickets are random, hashed in upload_sessions, actor/household/target/size/session-bound, expire in five minutes and are consumed after successful binary persistence. They travel only in a request header; upload URLs contain an upload ID. Failed type/size/checksum/processor validation can retry the same unused ticket before expiry. Expired tickets require a new reservation/key; same-session ticket renewal is not implemented.

Client filename and MIME do not select storage paths or final MIME. JPEG/PNG/WebP/PDF magic signatures select MIME; SVG/HTML signatures fail. SHA-256 describes final original-file bytes; optional upload SHA verifies incoming bytes before processing. Confirmation checks the original target and current expected revision. Same-key retry returns the receipt; another confirmation key returns the same attachment without another revision/event. A failed confirmation leaves no link/event; its unlinked blob remains recoverable until GC.

Binary routes require protocol 2. Local mode requires the existing bearer token; cloud mode uses existing authenticated session/account/household checks. PUT additionally requires exact same Origin, `X-Acornary-Request: web`, octet-stream and the upload-ticket header. Download responses are no-store/nosniff with restrictive CSP and Content-Disposition attachment (including images). `?variant=thumb` returns 404 when unavailable. Sensitive downloads require `reveal_sensitive=true` and a committed audit; HTTP reveal also requires same-origin request headers. A note's sensitivity is a floor for its attachments. `get_note` reveal is also audited; ordinary detail remains redacted afterward. The server does not put reveal values in operation receipts or sync payloads.

`cleanupAttachments(ctx, blobs, leases?)` removes unlinked sessions/files after 24 hours and detached/unreferenced blobs after 30 days. It uses the household lock shared with upload/finalization/detach, has no scheduler and is repeatable. Failed writes use session-derived keys so GC can also sweep staged/uncommitted file artifacts. A backup integration must supply `BackupLeaseGuard.withDeletionLease(household, storageKeys, remove)`, hold exclusion for the entire callback, and defer it while a backup manifest reads those keys. Omitting the guard assumes no concurrent backup reader. The production backup lease provider is not implemented.

## Verification

Both typechecks passed:

```sh
../../node_modules/.bin/tsc --noEmit
../../node_modules/.bin/tsc -p apps/web/tsconfig.json
```

Targeted tests: **28 passed, 0 failed**: 15 Batch 7 tests plus 13 existing Batch 1 sync-write regression tests. No full suite, network listener, Docker or PostgreSQL startup was run. Blob files use a temporary directory removed after tests. The existing root Vitest config excludes nested suites, so the runner explicitly overrides include:

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w2_files node --input-type=module -e 'import { startVitest } from "vitest/node"; const v = await startVitest("test", ["tests/batch7", "tests/batch1/sync-writes.test.ts"], { watch: false, include: ["tests/batch7/*.test.ts", "tests/batch1/sync-writes.test.ts"], fileParallelism: false }); await v?.close();'
```

The installed runtime reports Node 26.7.0, while package.json requests Node 24. Verification under Node 24 remains an integration check. Fastify emitted its existing disableRequestLogging deprecation warning.

| Case    | Result             | Evidence / remaining scope                                                                                                                                                                       |
| ------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MODEL12 | PASS               | Lossless legacy fixture, Item/CatalogNode targets, stable IDs, updated_by, archive/restore, owner revisions/events, no-op, stale/cross-household rejection, atomic edit_item and sync regression |
| FILE01  | PASS, server scope | MIME disguise, SVG/HTML rejection, JPEG/PNG/WebP signatures, PDF authenticated binary/nosniff/download headers, final SHA and private permissions                                                |
| FILE02  | PARTIAL            | Honest null dimensions/no thumbnail/no EXIF stripping tested. No decoder, pixel-limit/orientation/EXIF or sharp/container integration                                                            |
| FILE03  | PASS               | Real concurrent reservation races for target count and household quota, expiry release, file-size limit and 80% warning                                                                          |
| FILE04  | PASS               | Same-key/second-key confirmation, stale revision rollback, actor/target/size/checksum/expiry guards, failed processor then retry, Note/CatalogNode ownership and soft detach                     |
| FILE05  | PARTIAL            | 24h/30d boundaries, repeat GC and callback lease deferral tested; actual backup manifest/lease provider and distributed race not integrated                                                      |
| FILE06  | PARTIAL            | Central redactor scope matrix, note/attachment/get_item summaries and receipt reclassification tested; repository-wide legacy readers/errors/log adapters remain outside this lane               |
| FILE07  | PARTIAL            | Server audited reveal, no revision increment, subsequent read redacted, binary no-store; frontend base-cache exclusion not implemented/tested                                                    |
| FILE08  | PARTIAL            | Header ticket/private storage, bearer auth, Origin/CSRF, protocol, binary CSP and MCP ticket rejection tested; private plugin transport/OAuth binary channel not integrated                      |

## Known gaps / merge blockers

1. **Media:** PassthroughMediaProcessor deliberately keeps original bytes, records width/height null and exif_stripped=false, and produces no thumbnail. Signature sniffing is not image decoding or structural validation. Later sharp integration must decode/validate, reject >20 MP, auto-orient, strip EXIF, cap processing concurrency at one, generate <=512px thumbnails, and validate storage accounting. Do not claim FILE02 is complete.
2. **Global redaction and snapshot ownership:** current `apps/server/src/web.ts` still selects note bodies into the v1 snapshot. Existing history/debug/search/export/other receipts and registry fields do not all call the new redactor; existing note-body search can still match SECRET/archived notes. Those files/paths were explicitly excluded. This lane must not be presented as a completed redaction_v2 rollout, or enabled for production SECRET data, until the owning lanes remove snapshot bodies and wire all read/search/cache boundaries. get_item still has its existing flat envelope; only its note/attachment summaries changed. The central helper accepts field sensitivity metadata but does not invent or modify registry metadata.
3. **Plugin and session integration:** generic MCP text output cannot safely carry upload tickets, so create_attachment_upload is rejected from MCP even for receipt replay. The plugin lane must implement app-only private _meta/header transport and OAuth binary-route authorization before enabling that path. Tickets bind to actor and upload session, not a distinct browser-login session identifier; login-session binding/renewal requires the shared auth transport integration.
4. **Backup:** lease interface and deferral tests are present; no production lease implementation or scheduler was added. Backup integration must supply the guard before running GC alongside backups.
5. **Shared HTTP/permissions:** binary routes map the new attachment status codes. The existing generic JSON write endpoint uses `packages/contracts/src/errors.ts`, outside ownership; new quota/size errors there still fall back to HTTP 400 until the integration lane adds 409/413 mappings and recovery classifications. Existing deploy grants also need privileges for the new tables and audit identity sequence before non-owner deployment. Cloud session authentication reuses existing code; Batch 7 route tests exercise local bearer mode, not a live cloud login.

These are explicit integration boundaries, not silent acceptance passes. The dedicated backend tests and typechecks have no remaining failures.
