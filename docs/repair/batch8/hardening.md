# Batch 8 backend hardening

Implemented on `codex/wave4-hardening`, based on integration `2d11582`. Only the owned migration, contract/error wiring, server protocol/debug/readiness/error plumbing, restore verifier, tests and this document changed. No dependencies, scheduler, client changes or edits to other lanes' internals.

## Database rollout

`018_hardening.sql` follows all 22 existing migration files (006 remains intentionally absent). It adds:

- Named event insert guards for existing, same-household ITEM/CATALOG_NODE targets, with key-share locks. The fixed-search-path, owner-executed existence helper permits ACTOR reference locks without granting runtime UPDATE on actors. Events remain append-only, with named mutation errors.
- Exact event/source vocabulary checks, added `NOT VALID` and validated in the migration transaction. No audit rows are rewritten. The service event map is typed against the shared vocabulary.
- Named note/attachment/upload guards, retaining the legacy note insertion bridge. Notes accept ITEM/CATALOG_NODE; attachments and uploads also accept NOTE.
- Same-household reference source and target checks on insert/update. Existing split source/child/receipt foreign keys, positive quantities, distinct source/child and unique child constraints are retained. Added split guards keep a split's source/operation/basis/unit consistent, prevent a second split ID for the same source, and make provenance append-only.
- Historical target/reference/split preflight in the same transaction. Invalid history aborts deployment; it is never deleted or normalized. Vocabulary validation also aborts on unknown historical values. A two-second lock timeout allows retry instead of waiting indefinitely for an online writer.
- Conditional runtime grants for attachment metadata and audit insertion; explicit revocation of event/split UPDATE/DELETE. Run the existing `migrate.ts --grants` deployment step. If creating `acornary_app` after migrations, also apply the conditional grants from migrations 014–018 after role creation; those migration blocks only run when the role exists.

The existing migration-010 tree guards remain in place. No additional quantity/lifecycle rules are inferred into database constraints; application conservation rules remain Batch 6's responsibility.

Producer inventory: `service.ts`, `notes.ts`, `attachments.ts`, `terminal.ts`, `plugin.ts`, and repository seed/benchmark scripts. Actual deadline names are `ADD_DEADLINE`, `UPDATE_DEADLINE`, `REMOVE_DEADLINE`, `COMPLETE_DEADLINE`. There is no `SYNC_RESET` event producer; the existing administrative reset rotates `sync_generation` without inventing an event. Frozen source names WEB/MCP/TERMINAL/IMPORT/SYSTEM and existing MCP_UI/ANDROID/TEST/BENCHMARK/MIGRATION_TEST producers are allowed. `WEB_DEBUG` is read-only and is not an event source. Legacy `EDIT` remains accepted; note/attachment command internals and old event classifications are not rewritten in this lane.

## Errors and protocol switch

`mapDatabaseError` unwraps the PostgreSQL cause and maps 23505/23503/23514 using constraint/trigger names. Barcode uniqueness returns BARCODE_CONFLICT, operation uniqueness IDEMPOTENCY_CONFLICT, identity/policy uniqueness their domain conflicts, invalid references REFERENCE_INVALID, and state/provenance conflicts STATE_CONFLICT. Older tree trigger message prefixes are treated as stable identifiers because those triggers predate `CONSTRAINT` diagnostics. Unknown uniqueness falls back to STATE_CONFLICT, not ATTRIBUTE_VALIDATION_FAILED. Raw PostgreSQL detail is never copied into the domain error. Unknown connection/commit errors retain uncertain-outcome recovery.

Shared contracts define statuses/recovery for protocol, cursor, sync reset, reference, state, isolation, attachment quota/size/type, reveal and split errors. Both core and file command dispatchers use the mapper. Protocol errors use 409/FIX_REQUEST; state/sync conflicts use 409/REREAD_AND_REVIEW; idempotency conflict retains RECOVER_ORIGINAL_REQUEST.

`ACORNARY_REQUIRE_PROTOCOL_V2=1` is captured when the app starts. It requires `X-Acornary-Protocol: 2` for HTTP business reads/writes/UI data/sync/attachments/debug/terminal operations and MCP business tool calls. HTTP requests are rejected before their handlers; MCP is checked after JSON parsing so initialize/tool discovery/context negotiation remain available. Auth, health, version, session and context routes remain available under their existing authentication rules. There are no server-side pending-operation deletions on rejection.

Unset/other switch values preserve existing compatibility behavior. Existing sync and attachment endpoints already required v2, and continue to do so. The older snapshot route still serves its original response without the header. Enabling the switch is an explicit deployment action after client rollout, not something migration 018 does.

Both `/api/context` and `get_connection_context` use the same implemented feature list: query_v2, history_v2, snapshot_v2, groups_v2, sync_v2, profile_capabilities, deadline, notes_v2, attachments, stock, void, split, references, units_v2. Neither redaction_v2 nor protocol_v2 is advertised. Inspector-specific redaction does not establish full read-path redaction coverage.

## Inspector and readiness

The inspector adds catalog_policy_versions, catalog_proposals, catalog_identity_keys, attachments, attachment_blobs, upload_sessions, item_splits and attribute_references; notes now support catalog targets. All business relations use authenticated household scope in a read-only repeatable-read transaction. Pagination is capped at 200 and the opaque cursor is bound to the household and query filters. It remains live offset pagination, without a frozen-export guarantee.

Inspector output calls the existing `redactFor('inspect', ...)` mechanism. It is metadata-only: note body/title, attachment captions, storage keys, upload tickets, identity keys, policy/proposal payloads, event changes/reasons, operation results/fingerprints, core attribute payloads and migration errors/checkpoints are omitted with `redacted_paths`. No reveal bypass or auth tables are added. Entire opaque documents are omitted because legacy documents may contain unclassified secrets.

Startup verifies every shipped/release migration's APPLIED status and checksum, even without release.json. A release manifest must match the shipped files. UNVERIFIED historical checksums block startup until operators independently reconcile them with trusted release evidence; this implementation never stamps current file hashes as historical proof. All published known template schemas are checked against the compiled registry using the existing schema-hash function; UI-only fields do not affect it, unknown definitions are preserved, and stored hashes are checked where present. Templates are still lazily published; startup does not require every future version to exist in each household.

Attachment readiness checks directory creation plus a private write/fsync/read/delete probe. It does not prove all historical blobs are present. `/health` returns 200 or 503 with only status, version, commit, migration status/count, aggregate template hash, storage status and backup status. Backup remains explicitly `unverified`; there is no trusted production backup attestation in this checkout. Detailed failures and local paths are not in the public response.

## Backup and restore

Existing deployment pg_dump covers the entire database. The verifier still hashes every public table, now with a required inventory that explicitly includes all governance, registry/date/sync/label, note, attachment/blob/upload/audit, split and reference tables. It hashes full row contents without printing raw rows. It checks table counts and digests, including attachment metadata and detached blobs, and refuses incomplete manifests/restores.

Preferred production flow (operator-run; no new scheduler):

1. Hold a PostgreSQL exported snapshot open. Use that same snapshot for `pg_dump --snapshot` and `tsx apps/server/src/verify-restore.ts --write-manifest /secure/backup.json --snapshot <snapshot-id>`. The output is created exclusively with mode 0600. Retain the manifest with the dump.
2. Separately freeze the referenced immutable blob inventory and protect it from GC; copy bytes and thumbnails and record their SHA-256 values in a file manifest. **This lane does not implement or claim this byte-copy/GC-lease gate.**
3. Restore into an independent `acornary_restore_<timestamp>` database and independent blob directory. Run `tsx apps/server/src/verify-restore.ts <restored-name> --manifest /secure/backup.json` using the source connection environment. Differences fail without repairing or deleting data.
4. Independently verify every restored file/thumbnail, association, byte digest and the backup encryption key. Then run the same verifier with `--reset-sync` to compare first and rotate every restored household's generation before reopening service. Existing bootstrap/catch-up generation checks reject old cursors. No frozen export sessions exist in this implementation.

The original one-argument verifier invocation remains compatible with deployment and CI. Without `--manifest` it compares the source and restored databases as before, and reports `comparison_basis: quiescent_source_required`. Use it only with a source kept unchanged since the backup; it is not online backup-time evidence. No cross-lane deploy/script edit was needed.

Every result reports `attachment_bytes: NOT_VERIFIED`. A database digest match alone never establishes attachment recovery or an offsite restore. NAS/SFTP credentials, independently retrievable encryption keys, matching application/auth secrets, file manifests and an actual isolated restore remain production gates. Full-row hashing currently loads one table at a time; production-scale resource testing remains separate.

## Validation and case status

Database: `postgres://postgres@127.0.0.1:55432/acornary_test_w4_hardening`, PostgreSQL 18.6. All 23 migrations applied from the supplied empty database, then the repository's existing `--grants` step. During development the unreleased migration 018 was rolled back structurally and reapplied through the migration runner over valid fixtures to fix the ACTOR row-lock privilege check; no audit rows or checksums were rewritten to conceal that change. No Docker/PostgreSQL process was started and no full suite ran.

| Cases | Result | Evidence / limitation |
| --- | --- | --- |
| OP08 | PASS | Both target kinds; absent, wrong-kind and cross-household rejection; immutable event updates/deletes; valid historical event rows byte-equivalent across migration reapplication; invalid historical target aborts rollout |
| OPS05 | PARTIAL | Default compatibility and enabled-switch rejection, accepted v2 reads, negotiation routes, identical feature lists, blocked writes leave receipts unchanged; client cache/pending-operation retention needs the client lane |
| OPS06 | PARTIAL | All required tables and attachment metadata in digests, drift/missing-table rejection, exported-snapshot consistency despite concurrent source mutation, sync generation invalidation without receipt deletion; no actual dump/restore or blob-byte recovery claimed |
| OPS07 | NOT_RUN | Explicit test todo for independent NAS/SFTP decryption/offsite restore; credentials and independently held keys unavailable |
| OPS08 | PASS | Registered event/source vocabulary, unknown rejection, actual barcode constraint mapping, stable status/recovery, runtime-role event/ACTOR-reference insert success and actor/history UPDATE/DELETE/admin-reset denial |
| OPS09 | PASS | Scoped/paginated governance inspector with metadata redaction, all-migration/template checks, storage failure/readback, sanitized 200/503 health |

Batch 8: **12 passed / 1 todo** (`tests/batch8/hardening.test.ts`). Targeted registry/deadline/query-cursor regressions: **27 passed**. Both root and Web TypeScript checks passed. The first regression run exposed that baseline deployment grants had not yet been applied to the fresh test database; after `migrate.ts --grants`, the runtime-role regression passed. No source change was needed for that environment setup.

Reproduce from this worktree:

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w4_hardening ../../node_modules/.bin/tsx apps/server/src/migrate.ts
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w4_hardening ../../node_modules/.bin/tsx apps/server/src/migrate.ts --grants
../../node_modules/.bin/tsc --noEmit
../../node_modules/.bin/tsc -p apps/web/tsconfig.json
cat > /tmp/acornary-batch8-vitest.mjs <<'CONFIG'
export default { test: { include: ['tests/batch8/*.test.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 } };
CONFIG
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w4_hardening ../../node_modules/.bin/vitest run --config /tmp/acornary-batch8-vitest.mjs
```

No implementation blocker within the owned backend scope. Remaining integration gates: client cache retention, independently verified historical migration checksums, production constraint-lock/performance budget, attachment bytes/manifest/GC coordination, and an actual offsite restore. Prior Batch 7 limitations (including broad read-path redaction and media processing) are not promoted to implemented features by this lane.
