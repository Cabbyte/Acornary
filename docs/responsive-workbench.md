# Responsive Workbench history

> 本文记录 v0.4.2 发布时的旧工作台与验收证据；18 条分页和旧 SVG/CSS 不再描述本分支。当前迁移实现见 [Ant Design 统一界面](./antd-ui.md)，尚未正式部署。

Implemented on 2026-10-03, merged through [PR #6](https://github.com/Cabbyte/Acornary/pull/6) and deployed in [v0.4.2](https://github.com/Cabbyte/Acornary/releases/tag/v0.4.2). Current release status is recorded in [project progress](./progress.md).

Design source: [Acornary Responsive Workbench](https://www.figma.com/design/Xt5Dcp0NHtYPC0UbSF3iHO/Acornary?node-id=128-358). Desktop `136:361`, mobile `136:374`, item detail `136:375`, desktop move/edit `136:370` / `136:372`, mobile move `136:385`.

## Shared UI

- One React workbench serves `/items`, `/places/:id` and `/items/:id`. Desktop uses a 224px location sidebar, compact rows and a 344px inspector; mobile uses the same data, selection and actions with two-line rows, a location sheet and full-page inspector. Intermediate desktop widths use 192px / 300px side panels.
- Search operates on the complete loaded inventory before pagination. Local scope, category, availability, sort and displayed columns are functional. Each page holds 18 physical items. Selection uses actual UUIDs and remains intact when a move is cancelled.
- Item rows contain text, status and location; no item image or per-item icon. Original Figma navigation/control SVGs are stored in `apps/web/public/design/workbench`.
- Existing comprehensive item details, consumption, notes and history remain available through `/items/:id/details`. Location actions retain create child, rename and move container.
- Existing account/household-scoped drafts, offline read-only behavior, revision conflict acknowledgement, identical-key retry and successful-write/failed-refresh recovery are reused. Stale or offline views cannot submit writes.

## Real writes and model mapping

`move_items` atomically moves 1–100 explicit item IDs through the existing domain service and household transaction. Every source revision must match; a conflict, cycle or invalid target rolls back the entire operation. The UI requires an explicit destination and shows its full path before confirmation. Single-item and container moves still use `move_item`.

`edit_item` changes only supplied fields: instance display name, availability, acquired date and an optional note belonging to that item. The fields and note save in one revision/history event; omitted values remain unchanged. Specification belongs to the shared SKU, so the item editor shows it read-only with a link to the existing product editor. Unrecorded availability is displayed as “未记录”; the mockup's “备用” maps to the existing “可用” state instead of inventing a new domain value.

Both commands share existing authorization, expected revisions and idempotency. No migration or direct production data edit is required. Their contracts also expose the operations through the existing MCP registration.

## Shared MCP Apps runtime

The production plugin source archive `e5fafc6` was reconciled before release: all 177 archived files matched the deployed v0.3.0 source manifest. The new workbench lives in `workspace.tsx` and is shared by the web entry and the existing MCP Apps entry. SVG assets are bundled inline, so the opaque sandbox needs no asset origin permissions. Search handles Enter without requiring native form submission; query-based inspectors publish the selected item's actual ID and revision to the host. History requests remain cancellable on account or household transitions.

The existing app-only write gateway, expected scope, persisted private drafts, exact idempotent retry and authorization clearing remain intact. No new host permission or database migration is introduced.

## Evidence

- Node 24.21.0 + PostgreSQL 18: typecheck, 66 tests in 10 files and both production builds passed on GitHub CI. New integration coverage checks atomic bulk moves, replay, rollback on conflicts/cycles, duplicate IDs, atomic item/note editing, unrelated field preservation and note ownership.
- In-app Chromium, with the production build served by Node 24: search `USB` returns 8 of 18 fixture items; unknown-state filtering returns only the unrecorded item. Desktop note editing refreshes the inspector and history. Mobile cancellation preserves selected items; confirmation moves three selected UUIDs together and refreshes source/target counts from 18/0 to 15/3.
- 360, 390, 600, 960, 1280 and 1600px viewports have no document horizontal overflow with the inspector open. Reviewed mobile list, mobile inspector, selection, move confirmation, desktop inspector and desktop edit dialog. Move target tree scrolls independently while the final action remains visible. Initial confirmation is disabled until a target is explicitly chosen.
- Local screenshots and audit: `output/workbench/{desktop,mobile,mobile-detail,mobile-selection,mobile-move,desktop-edit}.jpg`, `responsive-audit.json`, `asset-files.json`, `node24-verification.log`. Output artifacts are ignored by Git.
- The complete automated browser suite runs in GitHub CI, including web account/OAuth flows and the opaque MCP Apps sandbox. The first runs exposed regressions in the legacy editor, mobile action clearance and button sizing; these were corrected before release. Final run and deployment evidence are recorded in the release notes.
- The in-app browser also verified the new workbench in the opaque sandbox: all 35 displayed assets loaded from embedded data URLs. Screenshot: `output/workbench/plugin-desktop.jpg`.

## Local preview

Use the isolated preview procedure in [Web UI](./webui.md). `tests/seed-workbench.ts` creates synthetic inventory through domain commands and refuses databases without an `acornary_e2e_<digits>` name. Build with `pnpm build`, then serve `apps/web/dist` through the test server. Never seed or reset a production database.

The 2026-10-03 screenshots came from an isolated local preview. Its former worktree path and running containers are not prerequisites for the current implementation.

## Remaining boundaries

The inventory snapshot is still loaded in full; pagination is client-side. Real iPhone Safari, input methods, VoiceOver and ChatGPT/Codex plugin hosts have not been accepted in this change. Other product screens retain their previous design. Production evidence is recorded in [v0.4.2](https://github.com/Cabbyte/Acornary/releases/tag/v0.4.2); successful CI alone is not real-host acceptance. The user reported preliminary acceptance on 2026-10-05; no per-device or per-host checklist was supplied.
