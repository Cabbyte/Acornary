# Acornary UI candidates (RC1)

Public components live in `ui/` (generic controls) and sibling `../patterns/` (product presentation). They are controlled React components. No component owns a household session, business network, storage, fixture, approval challenge, or device execution.

`../theme/provider.tsx` supplies one controlled appearance preset and UI mode. Both dimensions change CSS variables without changing component identity. Base UI portals mount in the provider's portal container, including inside an iframe. Wrap the application once rather than giving each component a separate theme.

`../tokens/source.json` is the editable source. The generator derives CSS variables and the documentation snapshot; hover and active are derived at 12%/24% black. The legacy section retains its original values. The Tailwind v4 utilities are prefixed `vn`; no global Preflight is installed. Group CSS is scoped to `[data-acornary-ui='vnext']`.

Generic components adapt the shadcn Base UI source composition and use Base UI behavioral primitives. Each file records its specific source. Reference sources:

- https://github.com/shadcn-ui/ui/tree/main/apps/v4/registry/bases/base/ui
- https://base-ui.com/react/overview/quick-start
- https://www.w3.org/WAI/ARIA/apg/patterns/treeview/ (TreeView; Base UI does not provide a tree primitive)

Review fixtures and stories live only under `apps/web/review`. The Chinese workbench (6007) and Storybook (6006) render these same source components. The five composition examples are development adapters, not a separate component implementation or complete business page.

RC1 means a complete component design candidate, not user approval or completed production integration. See `docs/ux-vnext/component-review.md` and `component-catalog.json` for public IDs, states, links, and review status.
