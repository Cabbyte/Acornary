# Responsive Workbench implementation

2026-10-03 · `codex/responsive-workbench`, based on local Soft Gray commit `e2fb840`.

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

## Evidence

- Node 24.21.0 + PostgreSQL 18: typecheck, 58 tests in 9 files, production build passed. New integration coverage checks atomic bulk moves, replay, rollback on conflicts/cycles, duplicate IDs, atomic item/note editing, unrelated field preservation and note ownership.
- In-app Chromium, with the production build served by Node 24: search `USB` returns 8 of 18 fixture items; unknown-state filtering returns only the unrecorded item. Desktop note editing refreshes the inspector and history. Mobile cancellation preserves selected items; confirmation moves three selected UUIDs together and refreshes source/target counts from 18/0 to 15/3.
- 360, 390, 600, 960, 1280 and 1600px viewports have no document horizontal overflow with the inspector open. Reviewed mobile list, mobile inspector, selection, move confirmation, desktop inspector and desktop edit dialog. Move target tree scrolls independently while the final action remains visible. Initial confirmation is disabled until a target is explicitly chosen.
- Local screenshots and audit: `output/workbench/{desktop,mobile,mobile-detail,mobile-selection,mobile-move,desktop-edit}.jpg`, `responsive-audit.json`, `asset-files.json`, `node24-verification.log`. Output artifacts are ignored by Git.
- Existing browser regression selectors have been adapted to the new routes and controls. The complete automated browser suite was **not** rerun in this change; the browser evidence above is targeted interactive verification.

## Local preview

The current preview runs at `http://127.0.0.1:3210/items` in `acornary-workbench-preview`, using the isolated `acornary-workbench-pg` PostgreSQL container and database `acornary_e2e_20261003`. Both ports are bound to loopback. Its synthetic inventory was created with domain commands by `tests/seed-workbench.ts`; the seed refuses databases without an `acornary_e2e_<digits>` name. No production inventory was used.

Worktree: `/Users/timli/.codex/worktrees/acornary-responsive-workbench/Acornary`.

The preview serves `apps/web/dist`; after editing, run `pnpm build` and reload. To stop it without discarding the review data: `docker stop acornary-workbench-preview acornary-workbench-pg`. To resume: start the PostgreSQL container first, then the preview container.

## Remaining boundaries

The inventory snapshot is still loaded in full; pagination is client-side. Real iPhone Safari, input methods, VoiceOver and ChatGPT/Codex plugin hosts have not been accepted in this change. Other product screens retain their previous design. This branch has not been merged, pushed or deployed.
