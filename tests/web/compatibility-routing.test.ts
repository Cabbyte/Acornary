import { describe, expect, it } from 'vitest';
import { resolveApplicationLink } from '../../apps/web/src/app-vnext/compatibility-routing';
import { compactItemId } from '../../apps/web/src/lib/labels';
const id = 'item_00000000-0000-4000-8000-000000000001';
const sku = 'catalog_node_00000000-0000-4000-8000-000000000002';
const options = { origin: 'https://cf.example.test', preferredMode: 'management' as const };
describe('same-origin compatible application links', () => {
  it('preserves exact QR identity and does not rewrite a non-CF label to CF', () => {
    const short = compactItemId(id);
    expect(resolveApplicationLink(`/i/${short}`, options)).toEqual({
      kind: 'route',
      path: `/items/${id}`,
    });
    expect(resolveApplicationLink(`https://formal.example.test/i/${short}`, options)).toEqual({
      kind: 'external',
      url: `https://formal.example.test/i/${short}`,
    });
  });
  it.each([
    [`/items/${id}/details`, `/items/${id}`],
    [`/items/${id}/notes`, `/items/${id}?tab=notes`],
    [`/items/${id}/history`, `/items/${id}?tab=history`],
    [`/items/group/${sku}`, `/products/${sku}`],
    [`/catalog/${sku}/history`, `/manage/catalog?id=${sku}&tab=history`],
    [`/places/${id}`, `/manage/locations?id=${id}`],
    ['/settings/account', '/settings/auth'],
    ['/settings/households', '/settings/household'],
    ['/settings/printer', '/settings/printing'],
    ['/inspect', '/settings/inspector'],
  ])('maps %s without losing its target', (from, to) => {
    expect(resolveApplicationLink(from, options)).toEqual({ kind: 'route', path: to });
  });
  it('only applies a mode preference to a landing URL, never an explicit page', () => {
    expect(resolveApplicationLink('/', options)).toEqual({ kind: 'route', path: '/manage/items' });
    expect(resolveApplicationLink('/items?q=milk', options)).toEqual({
      kind: 'route',
      path: '/items?q=milk',
    });
    expect(resolveApplicationLink('/settings?mode=management', options)).toEqual({
      kind: 'route',
      path: '/settings?mode=management',
    });
  });
  it('retains an unresolved old task instead of dropping its parameters and original draft', () => {
    const originalPath = `/items/${id}?dialog=consume&target=${id}`;
    expect(resolveApplicationLink(originalPath, options)).toMatchObject({
      kind: 'legacy-task',
      originalPath,
    });
  });
  it.each([
    '//other.test/items',
    'javascript:alert(1)',
    '/i/broken',
    '/items/wrong',
    '/unknown',
    '/items\\elsewhere',
  ])('rejects malformed links %s', (input) => {
    expect(resolveApplicationLink(input, options).kind).toBe('invalid');
  });
});
