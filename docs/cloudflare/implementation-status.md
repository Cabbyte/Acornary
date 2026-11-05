# Cloudflare migration implementation checkpoint

Baseline: `18f7e0496ecb4fb960a6619f12f57c68b3898410`.
Branch: `codex/cloudflare-native`. Preview target: `https://cf.acornary.protium.top`.

## Implemented and verified

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

- Native household schema and synchronous domain engine now implement all 54 baseline operations. Seventeen workerd tests run real commands, approvals, decimal splits, trees, history, notes, date projections, frozen exports, sync cursors, revocation and rollback; the suite asserts every baseline operation has executed successfully.
- Runtime R2 transport uses DO reservation/attempt leases, immutable R2 objects, read-back SHA-256 and DO confirmation. A 25 MiB upload/download, duplicate retry, checksum rejection and sensitive/cross-account denial pass in workerd/R2.
- D1 credential commands use conditional guards and atomic batches rather than callback transactions. Four D1 tests cover concurrent password changes, last-credential retention, one-use passkey ceremonies, disabled accounts and concurrent rate limits. Local Chrome virtual-authenticator registration and subsequent Passkey login also pass; physical authenticators remain a separate gate.
- Native Fetch entrypoint implements REST, sync, inspector, attachments, MCP SDK tools/resources and Android routes over the same household DO. Seven HTTP integration tests run real Better Auth D1 login, consent, PKCE, MCP scope enforcement, refresh rotation, Android audience restrictions, native inventory writes and account disable. All 54 MCP input schemas and read-only annotations match the frozen baseline.
- Household create, rename, invite, redeem and leave use persistent D1 account tasks plus transactional DO outbox. Injected directory failures recover without duplicate households; revoked membership denies access even while its D1 index is stale.
- Structured RPC errors preserve domain codes and revisions; ingress logs request/DO timing and idempotent replay without request bodies or credentials.
- Household importer and operator CLI now preserve 26 household fact tables, IDs, revisions, raw JSON and chunked receipts. Real PostgreSQL-to-DO tests verify resume/Merkle proofs, every persisted cell, bigint cursors, generation reset and equivalent Decimal command results. A private service binding gates activation on the completed D1 import and actual R2 byte verification. The read-only production snapshot has been imported and both households activated remotely.
- CIMD Worker transport validates public HTTPS hosts, rejects redirects and limits time/bytes. The real Cloudflare diagnostic passes public front-door, credential stripping, redirect/size/deadline and fixed private-DNS checks. The same custom-zone check also passes; controlled dynamic rebinding remains open.

- Native queue consumers and household alarms recover directory projections and account tasks. Expired upload cleanup first terminates the DO lease, then deletes R2 bytes and acknowledges the outbox; tests prove late confirmation cannot resurrect a cleaned object.
- Daily resumable D1/DO/R2 backups now have immutable manifests, 30-day retention, pins and shared-object deletion leases. Empty-environment restore verifies source hashes and actual attachment bytes before activation, restores credentials/business receipts and resets sync generation. Local joint restore and corruption/retention tests pass; see [backup runbook](backups.md).
- Root build/start and CI now target Cloudflare only. The existing full Web/MCP UI Chromium suite runs against actual workerd/D1/DO/R2: 70 pass, with 3 disabled registration/email-recovery scenarios explicitly skipped. 144 pure tests and all types pass. The 15-scenario WebKit subset also passes, including restored focus after responsive sheet resizing.
- Actual WebUI and MCP UI assets build with a visible preview label. The application preview Wrangler config passes dry-run, preserves API/health/discovery routing ahead of the SPA and includes explicit isolated bindings. It is deployed at the preview Custom Domain with independently verified TLS.

## Deployed preview and remaining acceptance

The complete application is deployed on Workers Free at `https://cf.acornary.protium.top`. The production SSH connection was restored. A consistent read-only production snapshot was verified and imported into isolated D1/DO/R2, with separate preview credentials and OAuth issuer. Production still runs v0.13.0 / `a7252bc`; the source contract baseline is v0.13.1 / `18f7e04`.

D1 migrations 0001–0005 are applied; both queues are bound to the application; private R2, SQLite DO and Static Assets are active. Actual Cloudflare acceptance covers REST/MCP, a 25 MiB attachment, Queue-backed backup and empty-environment restore. Actual-domain browser password/virtual-Passkey login and Codex CLI OAuth pass. The Android preview client is provisioned; its API command and history flow passes remotely. Full receipts and remaining client/security/observation boundaries are recorded in [acceptance evidence](acceptance.md).

The native runtime contains no PostgreSQL, Fastify, Caddy, server attachment directory or legacy owner-token backend. The source baseline is extracted into ignored `output/cloudflare-reference` only for comparisons. The first unsupported CPU configuration was removed at the user's request; no business feature was removed to deploy on Free. The final 25 MiB upload rerun hit HTTP 503 / Cloudflare 1102 and a confirmed `exceededCpu` outcome. Full Free-plan acceptance is blocked; Workers Paid is now recommended, without reducing the attachment contract. No upgrade has been performed.

Remote restore stages verified immutable backup objects, then restores auth and each household into separate unrouted resources. A transient R2 transport failure led to resumable copy receipts and bounded retries; the resumed rehearsal passed. Restoring two households took 187 seconds after staging, not including resource provisioning or copying.

ChatGPT host, physical Android/Passkey/printing, controlled dynamic DNS rebinding, broader differential source-runtime sequences and seven-day observation are not declared complete. An upstream Codex metadata fetch returned 403 during a separate HTTP test despite successful real CLI authorization; monitor this external dependency without bypassing validation.

Wrangler OAuth supports manual releases. GitHub CI and Android signing are configured; automatic preview deployment remains disabled pending a dedicated Environment API token. See [release runbook](preview-release.md). Existing production and unrelated Cloudflare resources remain untouched.

## Cutover invariant

Old production is the only authoritative writable inventory during preview. Preview uses an independent production snapshot; discard preview writes before final migration. Production cutover requires the planned acceptance gates and final write-fenced snapshot. After the first new production write, rollback is a compatible Cloudflare code rollback, not a DNS-only return to PostgreSQL.
