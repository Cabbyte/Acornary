import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { createApplicationRouter } from '../../apps/web/src/app-vnext/router';

it('does not present an unknown task kind as an actionable registered page', async () => {
  const router = createApplicationRouter({
    history: createMemoryHistory({ initialEntries: ['/tasks/not-a-command'] }),
    screen: () => createElement('p', null, 'Actionable screen'),
    notFound: () => createElement('p', null, 'Unavailable page'),
  });
  await router.load();
  const html = renderToString(createElement(RouterProvider, { router }));
  expect(html).toContain('Unavailable page');
  expect(html).not.toContain('Actionable screen');
  router.history.destroy();
});

it('keeps a valid managed location route and search context', async () => {
  const path = '/manage/locations?id=item_00000000-0000-4000-8000-000000000001';
  const router = createApplicationRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    screen: () => null,
    notFound: () => null,
  });
  await router.load();
  expect(router.state.matches.every((match) => match.status === 'success')).toBe(true);
  expect(router.state.location.href).toBe(path);
  router.history.destroy();
});
