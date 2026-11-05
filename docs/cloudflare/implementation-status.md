# Cloudflare migration implementation checkpoint

Baseline: `18f7e0496ecb4fb960a6619f12f57c68b3898410`.
Branch: `codex/cloudflare-native`. Preview target: `https://cf.acornary.protium.top`.

## Implemented and locally verified

- Independent worktree; existing working tree and production remain untouched.
- Frozen JSON Schema, read/write classification and descriptions for 54 public operations. `pnpm cf:contracts` detects changes. Capture is explicit: `pnpm exec tsx scripts/cloudflare/contracts.ts --capture`.
- Synchronous household transaction kernel using DO SQLite, membership-before-replay authorization, maintenance fence, idempotency receipts and transactional outbox.
- Five real workerd/D1 integration tests exercise duplicate concurrent writes, distinct concurrent writes, rollback, identity isolation and membership revocation, including reordered directory messages and revisions above the JavaScript safe integer limit. The test Worker is deliberately test-only; it is not an application entrypoint.
- `pnpm typecheck`, `pnpm cf:typecheck` and `pnpm cf:test:kernel` pass locally.
- Android `cfPreview` build type: separate application ID, callback host, app label, content-provider authority, link origin and cache scope. It cannot control the production AOD companion.
- CI checks native kernel/contracts; existing Android CI also builds and lints cfPreview.

## Not implemented / not accepted yet

This is an implementation checkpoint, **not a runnable migration release**. The kernel currently has only coordination tables; it does not implement the inventory commands or their complete business schema.

- Port all inventory/read/query/tree/date/intake/approval/notes/export/sync business behavior to SQLite.
- Full household schema and versioned import, preserving historical data and IDs.
- Worker REST/MCP/Static Assets entrypoint and existing UI integration.
- Full D1 authentication/account/OAuth request handling and cross-store directory recovery. The SDK-derived auth schema and monotonic directory projection store now exist; they do not constitute a working authentication server.
- CIMD public-network transport and real Cloudflare network security tests.
- R2 uploads/downloads, reservations, cleanup leases and byte-verified migration.
- Consistent PG snapshot export/import, resumable migration and verification.
- Queues, alarms, backups, restore rehearsal and observability.
- Production resource provisioning, release workflow, domain binding and application deployment. Preview D1/R2/Queue resources are provisioned; no Worker is deployed.
- Real Web, ChatGPT, Codex, Android and hardware acceptance; seven-day preview.

Do not delete the old runtime or deploy a static placeholder as the migrated product. Remove the old runtime only after the native behavior passes the same acceptance contract. Do not treat the toy stock table in the kernel test as a replacement inventory model.

## External prerequisites observed

On 2026-11-05, Wrangler OAuth login was verified after the user completed login. D1, R2 and Queues read/create operations succeeded. The API MCP is still not exposed to this chat, but Wrangler is usable and authentication is no longer a blocker.

Provisioned isolated preview resources (IDs/bindings in `apps/cloudflare/resources.preview.json`):

- D1 `acornary-cf-preview-auth` in APAC; migrations 0001 and 0002 applied remotely.
- Private R2 buckets `acornary-cf-preview-blobs` and `acornary-cf-preview-backups`.
- Queue `acornary-cf-preview-jobs`, currently without consumer or messages.

The resource config intentionally has no application entrypoint or domain route. It supports resource administration; it must not be deployed as a completed application. Production resources and the existing unrelated R2 bucket were not changed.

`pnpm cf:auth-schema` regenerates the expected SQL in memory from the locked SDK, checks drift and validates it against SQLite. `--capture` is only for creating a new reviewed baseline, not rewriting an applied migration. Runtime authentication implementation must use the same model configuration (user enabled/auth_version fields, JWT, Passkey, MCP, CIMD, database rate limits).

Android Gradle recognizes `assembleCfPreview` and `lintCfPreview`, but this machine has no configured Android SDK. `assembleCfPreview` could not compile. This build type does not currently generate a unit-test task; existing debug unit tests remain in CI. Its build/lint and real-device checks are still required.

## Cutover invariant

Old production is the only authoritative writable inventory during preview. Preview uses an independent production snapshot; discard preview writes before final migration. Production cutover requires the planned acceptance gates and final write-fenced snapshot. After the first new production write, rollback is a compatible Cloudflare code rollback, not a DNS-only return to PostgreSQL.
