# Native backup and recovery

Daily Cron runs at 19:17 UTC. Queue deliveries checkpoint progress in D1; retries reuse the same immutable R2 objects and the same frozen household snapshot. Unfinished runs are resubmitted by the next Cron. Inspect failed deliveries in `acornary-cf-preview-failed`; do not acknowledge failures as successful backups.

A completed backup contains:

- One D1 atomic snapshot of users, credentials, Passkeys and persistent account commands. Sessions, OAuth tokens/consents and authentication challenges are excluded.
- One synchronous SQLite snapshot per household, including all business facts, original operation receipts, binary receipt chunks, account command receipts and exact integer cursors. Each record is bounded and chunked, with a chained SHA-256 commitment and table counts.
- Every referenced R2 object's actual bytes, checked against inventory size and SHA-256. Shared content-addressed copies are held in the private backup bucket.
- A root manifest naming the source environment/origin/commit, authentication pages and household manifests. A run is COMPLETE only after every household and attachment is copied.

These are coordinated, individually atomic household checkpoints, not a claim that multiple databases share a global instantaneous transaction. Authentication is captured first; registration and account deletion remain closed. Household memberships are authoritative, directory indexes are rebuilt on restore, and persistent account commands recover through retained DO receipts. Each household manifest records its checkpoint time. Never replace this with independent D1/DO PITR and assume cross-store consistency.

The default retention is 30 days. Pin cutover/release recovery points before expiry. Expiry removes completed, unpinned sets; shared object deletion obtains a D1 lease only after all backup references disappear. A new backup registers its reference before copying bytes, preventing deletion races. Pending backups are retained for recovery. Original committed attachment objects are conservatively retained; only expired **unconfirmed** upload objects are currently automatically removed. Backups do not justify deleting referenced inventory bytes.

`BackupEntrypoint` is a named, account-authorized service binding. It has no public HTTP route. It supports `/start`, `/resume`, `/status`, `/pin` and `/restore/{begin,auth,household,finish}`. Operators explicitly provide the backup UUID and root SHA-256. Restore requires an empty D1 database and new household namespace, matching environment and origin. It never overwrites an active family. Restore validates schema, each chunk commitment, counts, foreign keys and actual attachment bytes before activating a household; it creates a new sync generation and rebuilds directory projections. Users log in and authorize clients again.

Run `pnpm cf:test:backup` for an empty-environment workerd/D1/DO/R2 restore exercise. It verifies credentials, household facts, private attachment download, corrupt-byte rejection, resumable chunks, retention pinning and expired object cleanup. `pnpm cf:test:inventory` separately verifies raw binary receipt chunks and cursors larger than JavaScript's safe integer range. Local RTO is test evidence only; remote restore duration must be measured before production cutover.

The private operator CLI accepts an explicit application JSON config and exactly one of `--remote` or `--local-state PATH`:

```sh
pnpm cf:backup --config apps/cloudflare/wrangler.preview.json --remote --action start --pin --wait
pnpm cf:backup --config apps/cloudflare/wrangler.preview.json --remote --action status --id BACKUP_UUID
pnpm cf:backup --config apps/cloudflare/wrangler.preview.json --remote --action resume --id BACKUP_UUID
```

For recovery, create fresh D1/DO/BLOBS resources, expose their private `BackupEntrypoint` and bind the source BACKUPS bucket. Keep the backed-up environment/origin unchanged, and keep public traffic fenced. Then run `pnpm cf:backup --config RESTORE_CONFIG.json --remote --action restore --id BACKUP_UUID --expected-sha256 ROOT_SHA256`. The command verifies the root before importing and reports restore duration. It resumes the identical restore plan after interruption. It cannot restore over an active family or substitute the preview origin for production.

Local Wrangler dev uses `--persist-to PATH`, while the operator's `--local-state` points to `PATH/v3`. An end-to-end local CLI start/restore exercise on 2026-11-05 completed for one browser-created family in 0.229 seconds. This is not the production RTO.
