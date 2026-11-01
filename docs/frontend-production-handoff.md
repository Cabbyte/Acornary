# Production frontend handoff — 2026-11-01

Work is on `codex/data-model-v2`, uncommitted. The pre-existing working tree changes were preserved. No dependencies were added during this pass. The existing demo server on `127.0.0.1:3210` and its database/container/network were kept running.

## Delivered

Core web routes now default to Quiet Ledger. `/items?ui=legacy` opts into rollback for the current tab, including subsequent old plain-anchor navigation; `/items?ui=next` switches back. The preference uses session storage when available and memory in the opaque MCP sandbox. `VITE_UI_NEXT=1` is no longer necessary. Old history/note subpages still resolve through their original pages.

### Write surfaces

The production surfaces are extracted while the existing `ActionSheet` remains the shared command/draft controller:

- `apps/web/src/features/writes/ConsumeSheet.tsx`: amount/unit, measurement basis, decimal validation and remaining preview.
- `apps/web/src/features/writes/MoveSheet.tsx`: searchable destination tree, invalid/current/cyclic destinations disabled, current paths and destination confirmation; works with single and batch actions.
- `apps/web/src/features/writes/EditSheet.tsx`: individual-item fields and a separate shared-product information tab. Legacy availability is read-only, as required by the frozen contract.
- `apps/web/src/features/writes/NoteSheet.tsx`: title/body fields and accessible required labels.
- `apps/web/src/features/writes/IntakeSheet.tsx`: searchable existing product, new-product draft, category/reason, count, location and optional dates/opening/quantity. The existing review and governance lifecycle is preserved.
- `apps/web/src/features/writes/AttributeEditor.tsx`: existing supported catalog/item template definitions rendered with the new Field primitive; no page-level binding inspection.
- `apps/web/src/features/writes/WriteButton.tsx`, `types.ts`, `WriteSheet.module.css`: shared visual contracts and token styling.
- `apps/web/src/features/writes/selectors.ts`: resolved-capability checks and terminal-item action availability, without copying profile defaults.
- `apps/web/src/features/writes/note-command.ts`: explicit feature-gated v1/v2 note payload validation and persisted-attempt compatibility.

`apps/web/src/ui/forms.tsx` still owns command construction, exact persisted attempts, revisions, draft keys, classification approvals, review, retries and conflict recovery. The new path adds draft-close confirmation, busy-close protection through Sheet, request-ID disclosure, initial idempotency keys, and invalidation of item/catalog/history/detail queries after snapshot refresh. Inputs remain available after failures; drafts survive close/reopen. Native field autofocus avoids delayed focus stealing while typing. Print retains its existing functional implementation.

Supporting changes: `apps/web/src/lib/draft.ts`, `lib/api.ts`, `lib/runtime.ts`, `plugin/client.ts` (gated `get_note` read transport), `ui/primitives/Field.tsx` (stable accessible names), and `ui/primitives/Sheet.tsx` (forward its footer prop).

### Routing and reads

- `apps/web/src/app/search.ts`: typed validation for `ui`, `view`, `location`, `category`, `q`, `sort`; legacy dialog parameters survive; cursors are excluded.
- `apps/web/src/workspace.tsx`: explicit TanStack route registrations for the requested core paths/aliases, default switch, rollback preference and lazy detail/catalog/activity/settings screens.
- `apps/web/src/features/items/screens/ItemsScreen.tsx`: URL-backed search/sort/category/location, server-side search without a second local search pass, `/` shortcut, session permissions, and row links retained in selection mode.
- `apps/web/src/features/items/screens/ItemsScreen.module.css`: remaining raw white color replaced with a token.
- `apps/web/src/features/api/query.ts`, `cursor.ts`: session-scoped query keys and clearing retained pages when leaving a filter; opaque cursor recovery remains supported.
- `apps/web/src/features/items/selectors/catalog.ts`: catalog binding/specification knowledge moved out of the page.
- `apps/web/src/next/screens/CatalogScreen.tsx`: server-side search, catalog detail actions, load-more, and unknown statistics shown as unknown instead of zero.
- `apps/web/src/next/screens/ItemScreen.tsx`: feature-gated attachments/redaction, session-scoped detail cache, operation availability, note editing.
- `apps/web/src/next/NextShell.tsx`: no household-account entry in MCP mode.

The unused `apps/web/src/next/screens/ItemsScreen.tsx` and its CSS module were removed after verifying that there were no imports. `apps/web/src/prototype/ItemsPrototype.tsx` remains source-only design reference; the production import and prototype route were removed.

### Feature audit

No deadline/stock management, attachment upload, void, split, sync, or sensitive-reveal actions were introduced. Attachment display and redaction indicators require their features. Notes use the v1 payload by default; v2 target-shaped payloads and full-body reads require `notes_v2`. Capability-specific intake fields require server-resolved capabilities when `profile_capabilities` is advertised. Baseline remains `query_v2/history_v2`.

## Verification

All final commands below passed:

```sh
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit
./node_modules/.bin/vitest run tests/frontend-foundation.test.ts tests/frontend-protocol.test.ts tests/frontend-tokens.test.ts tests/frontend-plugin-v2.test.ts tests/web/adapters.test.ts tests/web/item-selectors.test.ts tests/plugin.test.ts tests/workbench.test.ts tests/web-projection.test.ts tests/frontend-writes.test.ts
./node_modules/.bin/vite build --config apps/web/vite.config.ts
./node_modules/.bin/vite build --config apps/web/vite.plugin.config.ts
```

Vitest: **10 files, 52 tests passed**. New unit coverage in `tests/frontend-writes.test.ts` covers URL validation, capability defaults, v1/v2 note payloads and persisted retries.

Browser executable:

```sh
export PLAYWRIGHT_EXECUTABLE_PATH=/Users/timli/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell
./node_modules/.bin/playwright test tests/browser/next-ui.spec.ts tests/browser/next-writes.spec.ts tests/browser/webui.spec.ts tests/browser/antd.spec.ts tests/browser/navigation.spec.ts tests/browser/stash.spec.ts --grep-invert 'visual matrix'
./node_modules/.bin/playwright test tests/browser/plugin.spec.ts --grep 'icon navigation works|sandbox and isolates' --output output/playwright/plugin-results
```

Results: **34 passed, 1 cloud-only session test skipped**; **2 MCP tests passed**. The cloud OAuth/account visual matrix was not run against the local-mode server. No full database-less Vitest run was attempted.

`tests/browser/next-ui.spec.ts` covers default/rollback, attention/location/search/sort URLs, history restoration, row detail, no native selects/raw item IDs, cursor reset/INVALID_CURSOR, keyboard focus, mobile nav, overflow and screenshots at 1440×1000, 1024×1000 and 390×844. `tests/browser/next-writes.spec.ts` covers real intake/consume/edit/move/note writes, bounds validation, exact-request retries, busy dismissal, retained drafts, revision conflicts, offline and read-only sessions. Happy-path visual/write tests assert no console or page errors; fault-injection tests deliberately return HTTP errors.

Legacy test assertions were retained. `tests/browser/legacy.ts` selects rollback for the existing suites; imports changed in `accounts.spec.ts`, `antd.spec.ts`, `cloud.spec.ts`, `impeccable.spec.ts`, `inspector.spec.ts`, `navigation.spec.ts`, `plugin.spec.ts`, `stash.spec.ts`, `unified-auth.spec.ts`, `webui.spec.ts`. `tests/browser/login.ts` verifies authenticated local mode instead of attempting cloud login on the local demo. `tests/fixtures/plugin-host.js` passes the explicit rollback route into its storage-denied iframe. `playwright.config.ts` accepts the executable override while preserving cloud certificate settings.

The repository's `tests/seed-browser.ts` fixtures were added to the isolated demo database for legacy tests that require their named locations. Browser tests also created synthetic inventory. The original demo items were preserved, but the database is no longer limited to its original 11 physical items. The separately started MCP test host was stopped after verification; the user's demo server was not stopped.

## Screenshots and URLs

Artifacts are in `output/next/`:

- `list-1440.png`, `list-1024.png`, `list-390.png`
- `detail-1440.png`, `detail-1024.png`, `detail-390.png`
- `consume-1440.png`, `consume-1024.png`, `consume-390.png`
- `demo-attention-1440.png`, `demo-attention-390.png`: the six original expired bottles, verified separately with no console/page errors.
- `browser-results.txt`, `plugin-browser-results.txt`, `web-build.txt`, `plugin-build.txt`

Review: `http://127.0.0.1:3210/items`; rollback: `http://127.0.0.1:3210/items?ui=legacy`; explicit new UI: `http://127.0.0.1:3210/items?ui=next`.

Original six bottles: `http://127.0.0.1:3210/items?ui=next&view=attention&q=%E7%89%9B%E5%A5%B6%20%C2%B7%20%E7%AC%AC`.

## Deliberate deferrals / remaining risks

- The shared write controller and legacy pages remain. Explicit routes are registered, but workspace page selection still uses its compatibility dispatcher. Full provider/route-component relocation would be a separate architectural change.
- Print and account/household/printer subpages keep existing business components. Intake still follows its existing successful redirect to the new item detail; list-row receipt highlighting was not added.
- No backend contract changes. Container exclusion and attention filtering are still client-side over loaded results, with counts labelled “当前结果”. Counts/attention order are not claimed to represent every item beyond the current pages.
- F-feature backend implementations are unavailable. v2 note payload compatibility is unit-tested; live notes were tested against the existing v1 backend. Full server-driven template forms remain gated/deferred.
- Performance gate G6 is incomplete: Vite still warns about shared chunks over 500 kB; the 350 kB initial gzip target is not achieved by the combined legacy/new bundle. No new dependency was added to hide or work around this.
- Keyboard/focus, semantics and responsive behavior were checked, but an automated axe audit and the full cloud authentication suite were not run.
- No known regression in the exercised flows. These passing tests do not claim complete production/cloud/F-feature coverage.
