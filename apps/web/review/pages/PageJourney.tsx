import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
  useRouter,
} from '@tanstack/react-router';
import { AppShell } from '../../src/ui/patterns/app-shell';
import type { NavigationLink } from '../../src/ui/patterns/desktop-navigation';
import { DailyHome } from '../../src/features/daily/pages/daily-home';
import { DailySearch } from '../../src/features/daily/pages/daily-search';
import { DailyProduct } from '../../src/features/daily/pages/daily-product';
import { DailyItemDetail } from '../../src/features/daily/pages/daily-item-detail';
import type { DailyBrowseProps, DailyReadState } from '../../src/features/daily/pages/models';
import { useReviewAppearance } from '../appearance-context';
import { FeedbackPanel } from '../feedback/FeedbackPanel';
import { ReviewNote } from '../review-frame';
import { definitionForPath, safePagePath } from './catalog';
import {
  emptyProduct,
  firstItemId,
  history,
  householdId,
  itemFacts,
  locationOptions,
  notes,
  pageVersion,
  productFactsFor,
} from './fixtures';
import './pages.css';

interface NavigationSnapshot {
  top: number;
  focusIndex: number;
}
const PreviewContext = createContext({
  scenario: 'normal',
  scroll: new Map<string, NavigationSnapshot>(),
});
const focusSelector = 'button, a[href], input, [role="tab"]';
const links: NavigationLink[] = [
  { id: 'items', label: '物品', href: '#/items' },
  { id: 'attention', label: '留意', href: '/attention', disabled: true },
  { id: 'activity', label: '动态', href: '/activity', disabled: true },
  { id: 'settings', label: '设置', href: '/settings', disabled: true },
];

function PageScreen() {
  const { scenario, scroll } = useContext(PreviewContext);
  const pageSize = scenario === 'pagination' ? 5 : 50;
  const appearance = useReviewAppearance();
  const router = useRouter();
  const route = useLocation();
  const params = new URLSearchParams(route.searchStr);
  const page = definitionForPath(route.pathname);
  const host = useRef<HTMLDivElement>(null);
  const previousPath = useRef('');
  const [recovered, setRecovered] = useState(false);
  const [actualWidth, setActualWidth] = useState(390);
  const query = params.get('q') || '';
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  useEffect(() => setRecovered(false), [scenario]);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setActualWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (window.parent !== window)
      window.parent.postMessage(
        { kind: 'acornary-review-page', id: page.id, route: route.href },
        window.location.origin,
      );
    const main = host.current?.querySelector<HTMLElement>('.vn-app-shell__main');
    const remember = () => {
      if (!main) return;
      const focusIndex = [...main.querySelectorAll<HTMLElement>(focusSelector)].indexOf(
        document.activeElement as HTMLElement,
      );
      scroll.set(route.href, {
        top: main.scrollTop,
        focusIndex: focusIndex >= 0 ? focusIndex : (scroll.get(route.href)?.focusIndex ?? -1),
      });
    };
    const handle = requestAnimationFrame(() => {
      if (main) {
        const saved = scroll.get(route.href);
        main.scrollTop = saved?.top || 0;
        const focused =
          saved && saved.focusIndex >= 0
            ? main.querySelectorAll<HTMLElement>(focusSelector)[saved.focusIndex]
            : null;
        if (focused) focused.focus({ preventScroll: true });
        else if (scroll.size > 0 && previousPath.current !== route.pathname)
          main.focus({ preventScroll: true });
        previousPath.current = route.pathname;
        main.addEventListener('scroll', remember);
        main.addEventListener('focusin', remember);
      }
    });
    return () => {
      cancelAnimationFrame(handle);
      main?.removeEventListener('scroll', remember);
      main?.removeEventListener('focusin', remember);
    };
  }, [route.href, route.pathname, page.id, scroll]);
  const navigate = (path: string, replace = false) => {
    const main = host.current?.querySelector<HTMLElement>('.vn-app-shell__main');
    if (main)
      scroll.set(route.href, {
        top: main.scrollTop,
        focusIndex: [...main.querySelectorAll<HTMLElement>(focusSelector)].indexOf(
          document.activeElement as HTMLElement,
        ),
      });
    if (replace) router.history.replace(path);
    else router.history.push(path);
  };
  const update = (
    changes: Record<string, string | null>,
    path = route.pathname,
    replace = false,
  ) => {
    const next = new URLSearchParams(route.searchStr);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    navigate(`${path}${next.size ? `?${next}` : ''}`, replace);
  };
  const back = () => {
    if (router.history.canGoBack()) router.history.back();
    else navigate('/items', true);
  };
  const view = params.get('view') === 'products' ? 'products' : 'items';
  const requestedLocation = params.get('location');
  const locationId = locationOptions.some((entry) => entry.id === requestedLocation)
    ? requestedLocation
    : null;
  const state: DailyReadState = recovered
    ? 'ready'
    : (
        {
          loading: 'loading',
          error: 'error',
          forbidden: 'forbidden',
          offline: 'offline-partial',
          'offline-empty': 'offline-empty',
          'session-changed': 'session-changed',
        } as Record<string, DailyReadState>
      )[scenario] || 'ready';
  // Simulated read source: full fixture stays here; formal pages receive a single page only.
  const source =
    scenario === 'empty' ? [] : state === 'offline-partial' ? itemFacts.slice(0, 2) : itemFacts;
  const selectedLocation = source.find(({ item }) => item.location.id === locationId)?.item
    .location;
  const filtered = source.filter(
    ({ item }) =>
      (!locationId ||
        item.location.id === locationId ||
        (selectedLocation &&
          selectedLocation.path.every((part, index) => item.location.path[index] === part))) &&
      item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const catalogProducts = [
    ...productFactsFor(source),
    ...(scenario !== 'empty' && state !== 'offline-partial' ? [emptyProduct] : []),
  ];
  const products = (locationId ? productFactsFor(filtered) : catalogProducts).filter(
    ({ group }) =>
      group.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
      (!locationId || filtered.some(({ item }) => item.skuId === group.id)),
  );
  const rawPage = Number(params.get('page') || 1);
  const requestedPage = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage - 1 : 0;
  const pageData = <T,>(rows: readonly T[]) => {
    const index = Math.min(requestedPage, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
    const data = rows.slice(index * pageSize, (index + 1) * pageSize);
    return {
      data,
      pagination: {
        pageIndex: index,
        pageSize,
        loadedCount: data.length,
        knownTotal: state === 'offline-partial' ? null : rows.length,
        hasPrevious: index > 0,
        hasNext: (index + 1) * pageSize < rows.length,
        onPageChange: (value: number) => update({ page: String(value + 1) }),
      },
    };
  };
  const itemPage = pageData(filtered),
    productPage = pageData(products);
  const common = { state, onRetry: () => setRecovered(true) };
  const browse: DailyBrowseProps = {
    ...common,
    query,
    queryDraft: draft,
    onQueryChange: setDraft,
    onSearch: (q) => update({ q: q.trim() || null, page: null }, q.trim() ? '/search' : '/items'),
    view,
    onViewChange: (next) => update({ view: next, page: null }),
    items: itemPage.data,
    products: productPage.data,
    pagination: view === 'items' ? itemPage.pagination : productPage.pagination,
    locationId,
    locations: locationOptions,
    onLocationChange: (id) => update({ location: id, page: null }),
    onResetQuery: () => update({ location: null, q: null, page: null }, '/items'),
    onOpenItem: (id) => navigate(`/items/${id}`),
    onOpenProduct: (id) => navigate(`/products/${id}`),
    onBack: () => navigate('/items'),
  };
  const objectId = route.pathname.split('/')[2];
  const facts = source.find(({ item }) => item.id === objectId) || null;
  const product =
    catalogProducts.find(({ group }) => group.id === (facts?.item.skuId || objectId)) || null;
  const productItems = pageData(source.filter(({ item }) => item.skuId === objectId));
  const tab =
    params.get('tab') === 'notes'
      ? 'notes'
      : params.get('tab') === 'history'
        ? 'history'
        : 'overview';
  const missingState = (found: unknown): DailyReadState =>
    (state === 'ready' || state === 'offline-partial') && !found
      ? state === 'offline-partial'
        ? 'offline-empty'
        : 'not-found'
      : state;
  return (
    <div
      className="page-review-journey"
      ref={host}
      onClickCapture={(event) => {
        // The production shell uses ordinary anchor focus. Keep that anchor out of this
        // preview-only hash router, without changing the approved shared component.
        const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
          '.vn-app-shell__skip',
        );
        if (anchor) {
          event.preventDefault();
          host.current?.querySelector<HTMLElement>('.vn-app-shell__main')?.focus();
        }
      }}
    >
      <FeedbackPanel
        context={{
          component: page.id,
          name: page.name,
          scenario,
          preset: appearance?.preset || 'sage',
          mode: 'daily',
          viewport: actualWidth,
          version: pageVersion,
          route: route.href,
        }}
      />
      <p className="page-review-boundary">
        {pageVersion} · 日常只读预览 · 添加与使用等任务在后续批次开放
      </p>
      <AppShell
        mode="daily"
        onModeChange={() => undefined}
        modeBlockedReason="管理页面待装配"
        preset={appearance?.preset || 'sage'}
        onPresetChange={(preset) => appearance?.onPresetChange(preset)}
        links={links}
        activePath="#/items"
        onNavigate={(href) => navigate(href.replace(/^#/, ''))}
        householdId={householdId}
        households={[{ id: householdId, name: '梧桐之家 · 示例' }]}
        onHouseholdSwitchIntent={() => undefined}
        title={page.name.replace('页面 · ', '')}
      >
        {page.id === 'page-daily-home' ? (
          <DailyHome {...browse} />
        ) : page.id === 'page-daily-search' ? (
          <DailySearch {...browse} />
        ) : page.id === 'page-daily-product' ? (
          <DailyProduct
            {...common}
            state={missingState(product)}
            product={product}
            items={productItems.data}
            pagination={productItems.pagination}
            onOpenItem={browse.onOpenItem}
            onBack={back}
          />
        ) : (
          <DailyItemDetail
            {...common}
            state={missingState(facts)}
            facts={facts}
            product={product}
            notes={facts?.item.id === firstItemId ? notes : []}
            history={facts?.item.id === firstItemId ? history : []}
            tab={tab}
            onTabChange={(next) => update({ tab: next }, route.pathname, true)}
            onOpenProduct={browse.onOpenProduct}
            onBack={back}
          />
        )}
      </AppShell>
      <ReviewNote>
        本批为 P01 浏览链路及 S04 档案。固定家庭时区 Asia/Shanghai，样例日期判断基准为
        2026-11-07。每页意见随当前路由归档；反馈只写入本地审阅目录。读取失败、无权限与离线无缓存分别展示，均不解释为零库存。正式业务、写入任务与附件页面尚未接通。
      </ReviewNote>
    </div>
  );
}

export function PageJourney({ initialPath, scenario }: { initialPath: string; scenario: string }) {
  const [scroll] = useState(() => new Map<string, NavigationSnapshot>());
  const [router] = useState(() => {
    // Storybook stories may coexist; only the dedicated review iframe owns browser history.
    const storybook = window.location.pathname.endsWith('iframe.html');
    const requested = safePagePath(new URLSearchParams(window.location.search).get('route'));
    if (!storybook && !safePagePath(window.location.hash.slice(1)))
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}#${requested || initialPath}`,
      );
    const history = storybook
      ? createMemoryHistory({ initialEntries: [initialPath] })
      : createBrowserHistory({
          // Workbench query parameters and product query parameters have separate owners.
          // TanStack's stock hash history appends window.search, so use its supported
          // location adapter to avoid mixing review controls into product queries.
          parseLocation: () => {
            const url = new URL(
              safePagePath(window.location.hash.slice(1)) || initialPath,
              window.location.origin,
            );
            return {
              href: url.pathname + url.search,
              pathname: url.pathname,
              search: url.search,
              hash: '',
              state: window.history.state,
            };
          },
          createHref: (path) => `${window.location.pathname}${window.location.search}#${path}`,
        });
    const root = createRootRoute({ component: Outlet });
    const routes = ['/items', '/search', '/items/$itemId', '/products/$productId'].map((path) =>
      createRoute({ getParentRoute: () => root, path, component: PageScreen }),
    );
    return createRouter({
      history,
      routeTree: root.addChildren(routes),
      defaultNotFoundComponent: () => <p>页面不存在，请返回组件目录重新打开。</p>,
    });
  });
  useEffect(() => () => router.history.destroy(), [router]);
  return (
    <PreviewContext.Provider value={{ scenario, scroll }}>
      <RouterProvider router={router} />
    </PreviewContext.Provider>
  );
}
