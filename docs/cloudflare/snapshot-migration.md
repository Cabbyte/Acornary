# Snapshot export and D1 account import

These tools implement the source snapshot and D1 account/directory portion of migration. Household inventory import, R2 delivery, activation and the application Worker are still separate unfinished work. `AUTH_IMPORTED` does **not** mean the complete Acornary migration has finished.

## Export an isolated source package

Run the exporter where the PostgreSQL source and its attachment directory are accessible. Supply a read-only database connection in `ACORNARY_MIGRATION_DATABASE_URL` through the operator's secret environment. The tool intentionally does not use the application's `DATABASE_URL` as a fallback.

```sh
pnpm cf:snapshot export \
  --output /private/migration/preview-snapshot \
  --attachments-root /private/acornary/attachments \
  --source-commit 18f7e0496ecb4fb960a6619f12f57c68b3898410 \
  --mode preview
```

Use the **actual source deployment's full commit**, not the target branch's commit. The exporter records this operator-supplied value; it does not attest the source deployment. The output parent must exist and the output directory must be new. Keep snapshots outside the repository and shared/download directories. They contain private inventory and account data; production mode additionally includes password hashes and Passkey credentials. Created directories have mode `0700`, files `0600`.

All tables are read in one PostgreSQL `REPEATABLE READ READ ONLY` transaction with UTC timestamps. Known tables are explicitly classified; missing or unknown source tables stop the export. The manifest includes source migration rows, source transaction snapshot ID, per-table counts/byte hashes, excluded-table counts and per-object SHA-256 hashes. The exporter does not change source data.

- Preview keeps account IDs and membership facts but excludes `account` and `passkey` credentials.
- Production additionally preserves password hashes and Passkey records. OAuth bearer secrets in linked accounts are removed in both modes.
- Sessions, OAuth registrations/tokens/consents, JWKS, authentication challenges, upload reservations and temporary exports are excluded. Users must log in and authorize clients again.
- PostgreSQL `int8` and `numeric` top-level columns become decimal strings. JSONB content is exported as PostgreSQL text without a JavaScript parse/stringify round trip. Household inventory import must likewise avoid rounding nested JSON numbers.
- Every blob and thumbnail referenced by `attachment_blobs` is copied and hashed. Actual source bytes must agree with stored size/checksum. Concurrent deletion, missing files, symlinks or corrupt bytes fail verification. Metadata-only checks never report byte verification.

Attachments are immutable in the source application. If garbage collection removes a file during a live preview export, restart into a fresh output directory. A final production export additionally requires the planned server-side write fence and stopped cleanup jobs. This tool does not itself install that fence.

Save the returned `manifest_sha256` separately as the trusted package identity. Verify a transferred package using it:

```sh
pnpm cf:snapshot verify \
  --output /private/migration/preview-snapshot \
  --expected-sha256 SAVED_MANIFEST_SHA256
```

Verification rejects extra/missing table or blob files, incomplete table coverage, incorrect counts, lossy top-level decimal encoding, credential leakage and mismatched attachment bytes. A manifest hash proves identity against the operator's saved hash; it is not a digital signature. Do not treat the mere presence of `manifest.json` as verification.

Export cannot resume across disconnected PostgreSQL transactions: that would combine different snapshots. Failed exports retain diagnostic partial files without a completed verified manifest; restart with a new directory. Import resumes from the same completed, frozen package.

## Import accounts into an empty D1 destination

Apply the three checked-in auth migrations to the destination first. For the isolated preview database:

```sh
pnpm exec wrangler d1 migrations apply AUTH_DB \
  --remote --config apps/cloudflare/resources.preview.json

pnpm cf:import-auth \
  --snapshot /private/migration/preview-snapshot \
  --expected-sha256 SAVED_MANIFEST_SHA256 \
  --config apps/cloudflare/resources.preview.json \
  --database-id c61d4fc5-d759-468a-b0c9-cf6e155cdf9e \
  --mode preview --remote
```

The CLI uses Wrangler's authenticated remote binding proxy; no public migration endpoint or application Worker is needed. It validates the explicit destination ID against `AUTH_DB`. Local rehearsal uses `--local-state /private/migration/d1-state` instead of `--remote`. Both modes require an explicit destination and a trusted manifest hash. Runtime environment variables and other resource bindings are not loaded by the import proxy.

The import plan uses a fixed allowlist of account columns. It preserves IDs, password hashes, Passkey counters, auth versions and source timestamps. A legacy disabled owner is converted to `user.enabled = false`, preserving the source authorization rule without retaining a runtime `auth_owners` compatibility branch. Preview credentials remain empty and must be initialized separately.

An empty destination is reserved for one exact plan. Each bounded chunk writes its data, ordered receipt and progress in one [D1 atomic batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Out-of-order chunks, foreign-key failures or duplicate identities roll back together. Concurrent duplicate delivery returns the existing receipt. Restarting the identical command resumes at the persisted chunk; a different snapshot or plan is rejected. Existing application data is never upserted or overwritten.

Completion checks all expected account/directory row counts and records `AUTH_IMPORTED`. Household directory entries remain `PENDING`. Imported memberships are lookup projections, not authorization. Household DO import, authoritative membership verification, R2 verification and the activation coordinator must finish before traffic can be enabled. This implementation intentionally has no activation command yet.

## Evidence and repeatable checks

```sh
pnpm cf:test:snapshot
pnpm cf:check:auth-remote
```

The first command creates a disposable PostgreSQL 18 container, runs the real source migrations, exports fixtures and imports into real workerd D1. Docker is required. It checks consistent reads during concurrent source writes, int64 preservation, actual blob corruption, source schema drift, production/preview credential separation, disabled-owner conversion, import replay/resumption, rollback and the persistent local CLI. Containers and temporary files are removed afterward.

The second command is an explicit, authenticated live Cloudflare check. It creates a uniquely named temporary D1 database, applies the real migrations, verifies ordered/concurrent import behavior and deletes that database. It does not use production or the preview application's D1 data. It is not part of automatic CI.

On 2026-11-05 the live check passed against the APAC primary. The temporary database was deleted. Preview schema migration `0003_snapshot_import.sql` was also applied; no production snapshot has yet been loaded into preview.
