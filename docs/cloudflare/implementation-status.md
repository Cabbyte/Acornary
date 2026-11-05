# Cloudflare migration implementation checkpoint

Baseline: `18f7e0496ecb4fb960a6619f12f57c68b3898410`.
Branch: `codex/cloudflare-native`. Preview target: `https://cf.acornary.protium.top`.

## Implemented and locally verified

- Independent worktree; existing working tree and production remain untouched.
- Frozen JSON Schema, read/write classification and descriptions for 54 public operations. `pnpm cf:contracts` detects changes. Capture is explicit: `pnpm exec tsx scripts/cloudflare/contracts.ts --capture`.
- Synchronous household transaction kernel using DO SQLite, membership-before-replay authorization, maintenance fence, idempotency receipts and transactional outbox.
- Four real workerd integration tests exercise duplicate concurrent writes, distinct concurrent writes, rollback, identity isolation and membership revocation. The test Worker is deliberately test-only; it is not an application entrypoint.
- `pnpm typecheck`, `pnpm cf:typecheck` and `pnpm cf:test:kernel` pass locally.
- Android `cfPreview` build type: separate application ID, callback host, app label, content-provider authority, link origin and cache scope. It cannot control the production AOD companion.
- CI checks native kernel/contracts; existing Android CI also builds and lints cfPreview.

## Not implemented / not accepted yet

This is an implementation checkpoint, **not a runnable migration release**. The kernel currently has only coordination tables; it does not implement the inventory commands or their complete business schema.

- Port all inventory/read/query/tree/date/intake/approval/notes/export/sync business behavior to SQLite.
- Full household schema and versioned import, preserving historical data and IDs.
- Worker REST/MCP/Static Assets entrypoint and existing UI integration.
- D1 authentication/account/OAuth adapter and cross-store directory recovery.
- CIMD public-network transport and real Cloudflare network security tests.
- R2 uploads/downloads, reservations, cleanup leases and byte-verified migration.
- Consistent PG snapshot export/import, resumable migration and verification.
- Queues, alarms, backups, restore rehearsal and observability.
- Preview/prod resource provisioning, release workflow, domain binding and deployment.
- Real Web, ChatGPT, Codex, Android and hardware acceptance; seven-day preview.

Do not delete the old runtime or deploy a static placeholder as the migrated product. Remove the old runtime only after the native behavior passes the same acceptance contract. Do not treat the toy stock table in the kernel test as a replacement inventory model.

## External prerequisites observed

`wrangler whoami` reported not authenticated. This chat exposed Cloudflare documentation tools but no account management tools despite the configured API MCP. Login with `npx wrangler login` or expose the authenticated Cloudflare API MCP to the implementation chat. Do not paste credentials into chat or commit them.

Android Gradle recognizes `assembleCfPreview` and `lintCfPreview`, but this machine has no configured Android SDK. `assembleCfPreview` could not compile. This build type does not currently generate a unit-test task; existing debug unit tests remain in CI. Its build/lint and real-device checks are still required.

## Cutover invariant

Old production is the only authoritative writable inventory during preview. Preview uses an independent production snapshot; discard preview writes before final migration. Production cutover requires the planned acceptance gates and final write-fenced snapshot. After the first new production write, rollback is a compatible Cloudflare code rollback, not a DNS-only return to PostgreSQL.
