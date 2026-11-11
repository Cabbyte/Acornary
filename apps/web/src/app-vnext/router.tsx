import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  notFound,
  type RouterHistory,
  type RouteComponent,
} from '@tanstack/react-router';
import { applicationRoutes, safeApplicationPath } from './routing';

/** Web, MCP and isolated review register one route tree. The host supplies a
 * real page assembler and a platform history; this module does not pick a backend. */
export function createApplicationRouter(options: {
  history: RouterHistory;
  screen: RouteComponent;
  notFound: RouteComponent;
}) {
  const root = createRootRoute({
    component: Outlet,
    beforeLoad: ({ location }) => {
      if (!safeApplicationPath(location.pathname + location.searchStr)) throw notFound();
    },
  });
  const routes = applicationRoutes.map((path) =>
    createRoute({
      getParentRoute: () => root,
      path,
      component: options.screen,
    }),
  );
  return createRouter({
    history: options.history,
    routeTree: root.addChildren(routes),
    defaultNotFoundComponent: options.notFound,
  });
}
