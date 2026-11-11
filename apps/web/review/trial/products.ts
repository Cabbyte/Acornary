import { productFactsFor, emptyProduct } from '../pages/fixtures';
import { getManagementCatalogs } from '../pages/management-storage';
import { isTrial, getTrialScope } from './session';
import type { DailyItemFacts, DailyProductFacts } from '../../src/features/daily/pages/models';
export function trialProducts(facts: readonly DailyItemFacts[]): DailyProductFacts[] {
  const rows = productFactsFor(facts);
  if (!isTrial()) return rows;
  if (
    getTrialScope().householdId === 'preview-home-wutong' &&
    !rows.some((r) => r.group.id === emptyProduct.group.id)
  )
    rows.push(structuredClone(emptyProduct));
  for (const catalog of getManagementCatalogs()) {
    if (catalog.kind !== 'SKU' || catalog.hidden) continue;
    const row = rows.find((r) => r.group.id === catalog.id);
    if (row) {
      row.group = { ...row.group, name: catalog.name, profile: catalog.profile };
      row.catalogPath = catalog.path;
      row.subtitle = catalog.specification;
    } else
      rows.push({
        ...emptyProduct,
        group: {
          ...emptyProduct.group,
          id: catalog.id,
          name: catalog.name,
          profile: catalog.profile,
          count: 0,
          currentCount: 0,
          opened: 0,
          sealed: 0,
          unknownOpening: 0,
          unknownLifecycle: 0,
          locations: 0,
          totals: [],
          unknownQuantity: 0,
        },
        catalogPath: catalog.path,
        subtitle: catalog.specification,
      });
  }
  return rows;
}
