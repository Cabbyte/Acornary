# Cloudflare migration implementation checkpoint

Baseline: `18f7e0496ecb4fb960a6619f12f57c68b3898410`.
Branch: `codex/cloudflare-native`. Preview target: `https://cf.acornary.protium.top`.

## Implemented and locally verified

- Independent worktree; existing working tree and production remain untouched.
- Frozen JSON Schema, read/write classification and descriptions for 54 public operations. `pnpm cf:contracts` detects changes. Capture is explicit: `pnpm exec tsx scripts/cloudflare/contracts.ts --capture`.
- Synchronous household transaction kernel using DO SQLite, membership-before-replay authorization, maintenance fence, idempotency receipts and transactional outbox.
- Eight real workerd/D1 integration tests exercise duplicate concurrent writes, distinct concurrent writes, rollback, identity isolation, membership revocation, large UTF-8 receipts and schema upgrades, including reordered directory messages and revisions above the JavaScript safe integer limit. The test Worker is deliberately test-only; it is not an application entrypoint.
- Kernel schema v2 stores large operation receipts in transactional SQLite chunks. The source allows 4 MiB receipts, exceeding the [DO SQLite 2 MB row limit](https://developers.cloudflare.com/durable-objects/platform/limits/); a direct single-row port would lose valid operations. Receipt chunks, inventory changes and outbox entries roll back together.
- `pnpm typecheck`, `pnpm cf:typecheck` and `pnpm cf:test:kernel` pass locally.
- Android `cfPreview` build type: separate application ID, callback host, app label, content-provider authority, link origin and cache scope. It cannot control the production AOD companion.
- CI checks native kernel/contracts; existing Android CI also builds and lints cfPreview.
- Consistent read-only PostgreSQL snapshot exporter and byte-level package verifier. All source tables are classified; preview credentials and transient authorization data are excluded. Export preserves decimal/int64 text and rejects absent/corrupt attachments.
- D1 account/directory importer with fixed-manifest plans, ordered atomic chunks, durable receipts and restart support. Disabled legacy owners stay disabled; imported household directories stay pending. The operator CLI uses an explicitly selected local or authenticated remote D1 binding.
- R2 immutable blob importer verifies source bytes and stored bytes, preserves the 25 MiB attachment limit, resumes matching objects and rejects collisions without overwriting. Live Cloudflare R2 upload/read-back/retry checks passed; the temporary bucket was deleted.
- PostgreSQL-to-workerd D1 integration tests cover snapshot consistency, corruption, credential isolation, rollback, concurrent retries and resumption. The live Cloudflare D1 import check passed on the APAC primary; its disposable database was deleted. See [snapshot migration](snapshot-migration.md).

- Native household schema and synchronous domain engine now implement all 54 baseline operations. Fifteen workerd tests run real commands, approvals, decimal splits, trees, history, notes, date projections, frozen exports, sync cursors, revocation and rollback; the suite asserts every baseline operation has executed successfully.
- Runtime R2 transport uses DO reservation/attempt leases, immutable R2 objects, read-back SHA-256 and DO confirmation. A 25 MiB upload/download, duplicate retry, checksum rejection and sensitive/cross-account denial pass in workerd/R2.
- D1 credential commands use conditional guards and atomic batches rather than callback transactions. Four D1 tests cover concurrent password changes, last-credential retention, one-use passkey ceremonies, disabled accounts and concurrent rate limits. Browser Passkey ceremonies remain a separate acceptance gate.
- Native Fetch entrypoint implements REST, sync, inspector, attachments, MCP SDK tools/resources and Android routes over the same household DO. Six HTTP integration tests run real Better Auth D1 login, consent, PKCE, MCP scope enforcement, refresh rotation, Android audience restrictions, native inventory writes and account disable. All 54 MCP input schemas and read-only annotations match the frozen baseline.
- Household create, rename, invite, redeem and leave use persistent D1 account tasks plus transactional DO outbox. Injected directory failures recover without duplicate households; revoked membership denies access even while its D1 index is stale.
- Structured RPC errors preserve domain codes and revisions; ingress logs request/DO timing and idempotent replay without request bodies or credentials.
- Household importer and operator CLI now preserve 26 household fact tables, IDs, revisions, raw JSON and chunked receipts. Real PostgreSQL-to-DO tests verify resume/Merkle proofs, every persisted cell, bigint cursors, generation reset and equivalent Decimal command results. A private service binding gates activation on the completed D1 import and actual R2 byte verification. No production snapshot has been obtained.
- CIMD Worker transport validates public HTTPS hosts, rejects redirects and limits time/bytes. The required real Cloudflare private-network/DNS/same-zone gate has not yet run.

## Not implemented / not accepted yet

The complete native business and HTTP transport now run locally. This is **not yet a deployed migration release**: remote household import/activation, background recovery/backup and real Cloudflare acceptance remain in progress. No application Worker has been deployed.

- Complete differential comparison against the source runtime, household import and real-client acceptance.
- Static Assets deployment and real browser UI acceptance.
- CIMD public-network transport and real Cloudflare network security tests.
- R2 orphan cleanup consumer, backup retention coordination and real Cloudflare attachment transport acceptance.
- Remote household import, migration operator acceptance and real production snapshot rehearsal. The native household importer is locally tested; no production data has been imported yet.
- Queues, alarms, backups, restore rehearsal and observability.
- Production resource provisioning, release workflow, domain binding and application deployment. Preview D1/R2/Queue resources are provisioned; no Worker is deployed.
- Real Web, ChatGPT, Codex, Android and hardware acceptance; seven-day preview.

Do not delete the old runtime or deploy a static placeholder as the migrated product. Remove the old runtime only after the native behavior passes the same acceptance contract. Do not treat the toy stock table in the kernel test as a replacement inventory model.

## External prerequisites observed

Initial read-only SSH attempts to the production alias `ali` (`47.77.197.236:22`) timed out during banner exchange; the latest attempt was immediately closed by the remote endpoint. A connection/restored route is pending from the user for the consistent production snapshot; coding and isolated acceptance continue. No source production writes were attempted.


On 2026-11-05, Wrangler OAuth login was verified after the user completed login. D1, R2 and Queues read/create operations succeeded. The API MCP is still not exposed to this chat, but Wrangler is usable and authentication is no longer a blocker.

Provisioned isolated preview resources (IDs/bindings in `apps/cloudflare/resources.preview.json`):

- D1 `acornary-cf-preview-auth` in APAC; migrations 0001–0003 applied remotely.
- Private R2 buckets `acornary-cf-preview-blobs` and `acornary-cf-preview-backups`.
- Queue `acornary-cf-preview-jobs`, currently without consumer or messages.

The resource config intentionally has no application entrypoint or domain route. It supports resource administration; it must not be deployed as a completed application. Production resources and the existing unrelated R2 bucket were not changed.

`pnpm cf:auth-schema` regenerates the expected SQL in memory from the locked SDK, checks drift and validates it against SQLite. `--capture` is only for creating a new reviewed baseline, not rewriting an applied migration. Runtime authentication implementation must use the same model configuration (user enabled/auth_version fields, JWT, Passkey, MCP, CIMD, database rate limits).

This machine has no configured Android SDK, so verification was moved to GitHub Actions. At commit `9409c1f`, `assembleCfPreview`, `lintCfPreview` and the existing debug unit tests passed in CI; this build type does not currently generate its own unit-test task. Emulator results and real-device acceptance are tracked separately. A browser test failed while selecting an unfiltered virtualized product list; its selection now filters by the fixture product name before asserting the selected value.

## Cutover invariant

Old production is the only authoritative writable inventory during preview. Preview uses an independent production snapshot; discard preview writes before final migration. Production cutover requires the planned acceptance gates and final write-fenced snapshot. After the first new production write, rollback is a compatible Cloudflare code rollback, not a DNS-only return to PostgreSQL.
