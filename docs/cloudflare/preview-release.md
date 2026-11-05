# Native preview release

The only route this release command can deploy is `cf.acornary.protium.top`. Production remains on its existing server. The preview has separate D1, SQLite DO namespace, private R2 buckets, queues, issuer, signing secret, Android application ID and signing certificate. Imported preview data is disposable and is never synchronized back to production.

## Account prerequisites

The preview now targets Workers Free at the user's request. Omit `limits.cpu_ms`: Free does not support configuring that limit. The first remote deployment's `100328` error proved that the previous CPU configuration required Paid, not that the application requires Paid. Keep the complete application and contracts; assess Free using real Cloudflare requests, including authentication, attachments, background work and backup/restore. Record actual deployment errors, CPU-limit outcomes and quota failures before recommending an upgrade. Local workerd tests do not enforce the deployed plan's CPU limits. The final real 25 MiB upload rerun on 2026-11-05 returned 503 / 1102 with `exceededCpu`; see the [sanitized runtime evidence](evidence/2026-11-05-free-cpu-limit.json). The Free deployment remains online, but full acceptance is blocked and Workers Paid is recommended. No subscription change was made.

Wrangler OAuth is already usable for resource administration. For GitHub Actions, configure `CLOUDFLARE_API_TOKEN` in the `cloudflare-preview` GitHub Environment, restricted to the preview deployment's Worker, D1, R2, Queues and zone routing capabilities. Account/zone IDs are in the checked-in Wrangler config. Never store OAuth tokens or API tokens in source control or chat.

The preview deployment job remains disabled with repository variable `CF_PREVIEW_DEPLOY_ENABLED=false` until full remote acceptance and the environment secret are ready. Once enabled it waits for successful native checks and full CI **for the same commit**, and serializes preview deployments. It never publishes a production tag or calls SSH deployment.

## Operator sequence

1. Run `pnpm cf:contracts`, `pnpm cf:auth-schema`, types and the native workerd suites. Build assets with `pnpm cf:build`.
2. Run `node scripts/cloudflare/prepare-native-remote.mjs` and `node scripts/cloudflare/check-native-remote.mjs`. These use a separately named disposable full application and real Cloudflare D1/DO/R2/Queues. Their private operator bindings are not public HTTP endpoints. Keep `.local/cf-native-acceptance/report.json` with the acceptance evidence. A network-only diagnostic Worker is not an application release.
3. From a clean committed worktree, run `node --import tsx scripts/cloudflare/release.mjs --stage` after full remote acceptance. This deploys the complete preview Worker with no public route and provides its private migration bindings. Provision its independent `AUTH_SECRET` through Wrangler secret input. Then obtain the read-only consistent production snapshot using the [migration runbook](snapshot-migration.md). Preview mode excludes production credentials. Verify the manifest and all attachment bytes. Import D1, household facts and private R2 using the explicit manifest and resource config; initialize separate preview credentials with `node scripts/cloudflare/init-preview-account.mjs --config apps/cloudflare/wrangler.preview.json --remote --user IMPORTED_USER_ID`. The command creates a first credential only, writes a generated password to a private ignored local file, supports identical retries, and refuses disabled identities or password resets. Production SSH access was restored on 2026-11-05; the read-only snapshot and verified manifest are kept in the private ignored migration directory.
4. Confirm the independent preview `AUTH_SECRET` is provisioned. Never reuse the production secret. The preview D1 migrations, R2 buckets and both queues must exist before release. Household namespace creation is part of the Worker migration.
5. Commit changes, then run `pnpm cf:release:check`. It refuses a dirty worktree, builds the actual UI/Worker and writes `output/cloudflare-release/manifest.json`: commit, bindings, D1 migration digests, household schema/version and template digest.
6. Run `pnpm cf:deploy:preview` after the account and acceptance prerequisites are satisfied. This applies D1 migrations and deploys the committed application plus Static Assets to the preview Custom Domain. Cloudflare provisions DNS and TLS; verify the complete hostname and certificate. Do not infer TLS success from an HTTP health response.
7. After identity import, run `node scripts/cloudflare/provision-terminal.mjs --config apps/cloudflare/wrangler.preview.json --remote`. It registers only the preview Android public client, with PKCE, explicit audience and `/android/oauth/callback`. It is idempotent and refuses an incompatible existing client. Import comes first because the identity importer requires empty OAuth state.
8. Complete browser/Passkey, actual ChatGPT/Codex OAuth, Android, printer, remote backup/restore and network-boundary acceptance. Record unresolved checks in [acceptance evidence](acceptance.md). Start the seven-day observation window only after the complete application and isolated snapshot are available.

Resource provisioning and first deployment/import are separately resumable. An empty deployed Worker, a successful bundle, or local test data is not a completed production-data migration.

## Android preview

CI produces `acornary-cf-preview-apk` from `assembleCfPreview`, signed with its own persistent key. GitHub secrets `CF_PREVIEW_ANDROID_KEYSTORE` and `CF_PREVIEW_ANDROID_KEY_PASSWORD` were configured independently of production. Forks without those secrets can still compile with a debug key, but their APK is not the accepted App Links build.

Application ID: `top.protium.acornary.cfpreview`. Certificate SHA-256:

```
DD:FF:D0:88:78:90:C2:82:A9:2E:AC:A0:37:F9:CD:60:CC:66:1D:F4:B4:E3:98:AA:1B:2A:A1:A0:39:E6:4C:EC
```

The public certificate fingerprint is in the preview Worker config. The APK, OAuth callback, App Links, cache isolation and printer behavior still require acceptance on a physical device.
