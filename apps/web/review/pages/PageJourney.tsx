import reviewLedger from '../review-status.json';
import { Button } from '../../src/ui/components/ui/button';
import { DailyExtrasJourney, useExtraReviewNotes } from './DailyExtrasJourney';
import { ManagementJourney } from './ManagementJourney';
import { SettingsJourney } from './SettingsJourney';
import { useReviewWorld } from './inventory-session';
import { TaskJourney } from './TaskJourney';
import type { DailyTaskKind } from '../../src/features/daily/pages/daily-task';
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
import {
  DailyAttention,
  type AttentionCategory,
  type AttentionTask,
} from '../../src/features/daily/pages/daily-attention';
import { DailyActivity, type ActivityFilter } from '../../src/features/daily/pages/daily-activity';
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
  householdId,
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
  { id: 'attention', label: '留意', href: '#/attention' },
  { id: 'activity', label: '动态', href: '#/activity' },
  { id: 'settings', label: '设置', href: '#/settings' },
];

function PageScreen() {
  const { items: itemFacts, history } = useReviewWorld();
  const { scenario, scroll } = useContext(PreviewContext);

  const appearance = useReviewAppearance();
  const router = useRouter();
  const route = useLocation();
  const extraNotes = useExtraReviewNotes(
    route.pathname.startsWith('/items/') ? route.pathname.split('/')[2] : '',
  );
  const params = new URLSearchParams(route.searchStr);
  const page = definitionForPath(route.pathname);
  const pageSize =
    scenario === 'pagination'
      ? route.pathname === '/attention' || route.pathname === '/activity'
        ? 1
        : 5
      : 50;
  const taskKind = route.pathname.startsWith('/tasks/')
    ? (route.pathname.split('/')[2] as DailyTaskKind)
    : null;
  const extended =
    route.pathname.startsWith('/daily/') ||
    route.pathname.startsWith('/manage/') ||
    route.pathname.startsWith('/settings');
  const mode =
    route.pathname.startsWith('/manage/') ||
    (route.pathname.startsWith('/settings') && params.get('mode') === 'management')
      ? 'management'
      : 'daily';
  useEffect(() => {
    if (appearance && appearance.mode !== mode) appearance.onModeChange(mode);
  }, [mode, appearance?.mode]);
  const version =
    reviewLedger.entries[page.id as keyof typeof reviewLedger.entries]?.version || 'Pages-RC1';
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
    if (mode === 'management' && path.startsWith('/settings') && !path.includes('mode='))
      path += `${path.includes('?') ? '&' : '?'}mode=management`;
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
    ...(scenario !== 'empty' &&
    state !== 'offline-partial' &&
    !source.some((f) => f.item.skuId === emptyProduct.group.id)
      ? [emptyProduct]
      : []),
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
    onTask: (kind, target) =>
      navigate(`/tasks/${kind}${target ? '?target=' + encodeURIComponent(target) : ''}`),
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
  const category = (
    ['stock', 'loan', 'repair'].includes(params.get('category') || '')
      ? params.get('category')
      : 'date'
  ) as AttentionCategory;
  const activityFilter = (
    ['quantity', 'other'].includes(params.get('filter') || '') ? params.get('filter') : 'all'
  ) as ActivityFilter;
  // Explicit isolated household rule, not inferred from a product name or unknown quantity.
  const tasks: AttentionTask[] = source
    .filter((f) => f.date?.dueOn && f.date.state !== 'COMPLETED' && f.date.state !== 'UNKNOWN')
    .map((facts) => ({
      id: `date:${facts.item.id}`,
      category: 'date',
      facts,
      reason: `${facts.date!.label} · ${facts.date!.dueOn}`,
      basis: `${facts.date!.basis || '依据未记录'}；判断基准 2026-11-07，Asia/Shanghai。保留原日期类型。`,
    }));
  const dateRange = ['past', 'today'].includes(params.get('range') || '')
    ? params.get('range')!
    : 'upcoming';
  const selectedTasks = tasks.filter(
    (t) =>
      t.category === category &&
      (dateRange === 'past'
        ? t.facts.date!.dueOn! < '2026-11-07'
        : dateRange === 'today'
          ? t.facts.date!.dueOn === '2026-11-07'
          : t.facts.date!.dueOn! > '2026-11-07' && t.facts.date!.dueOn! <= '2026-11-14'),
  );
  const stocks =
    category === 'stock' &&
    scenario !== 'empty' &&
    state !== 'offline-partial' &&
    !source.some((f) => f.item.skuId === emptyProduct.group.id)
      ? [
          {
            group: { ...emptyProduct.group, lowStock: true },
            basis:
              '有效库存 0 件，低于示例补货规则 1 件；未知数量 0 件。可从商品资料进入入库任务。',
          },
        ]
      : [];
  const taskPage = pageData(selectedTasks);
  const stockPage = pageData(stocks);
  const activityRows = (
    scenario === 'empty' ? [] : state === 'offline-partial' ? history.slice(0, 1) : history
  )
    .filter(
      (e) =>
        !!e.event &&
        e.event.occurred_at >=
          (params.get('days') === '30' ? '2026-10-08T16:00:00Z' : '2026-10-31T16:00:00Z') &&
        e.event.occurred_at < '2026-11-07T16:00:00Z',
    )
    .filter(
      (e) =>
        activityFilter === 'all' ||
        (activityFilter === 'quantity'
          ? e.event?.changes.some((change) => change.path.startsWith('contents.'))
          : !e.event?.changes.some((change) => change.path.startsWith('contents.'))),
    );
  const operationGroups = new Map<string, typeof activityRows>();
  for (const entry of activityRows) {
    const id = entry.event!.operation_id;
    operationGroups.set(id, [...(operationGroups.get(id) || []), entry]);
  }
  const operationPage = pageData([...operationGroups.values()]);
  const activityPage = { data: operationPage.data.flat(), pagination: operationPage.pagination };
  let pendingPath: string | null = null;
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith('acornary-review-p03:')) continue;
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!saved || !['networkUnknown', 'submitting'].includes(saved.state)) continue;
      const [, kind, target, taskScenario] = key.split(':');
      pendingPath = `/tasks/${kind}?taskScenario=${encodeURIComponent(taskScenario)}${target !== 'default' ? '&target=' + encodeURIComponent(target) : ''}`;
      break;
    }
  } catch {
    /* preview storage may be unavailable */
  }
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
          mode,
          viewport: actualWidth,
          version,
          route: route.href,
        }}
      />
      <p className="page-review-boundary">{version} · 隔离预览 · 示例结果不会写入库存</p>
      <AppShell
        mode={mode}
        onModeChange={(next) => navigate(next === 'management' ? '/manage/items' : '/items')}
        preset={appearance?.preset || 'sage'}
        onPresetChange={(preset) => appearance?.onPresetChange(preset)}
        links={
          mode === 'management'
            ? [
                { id: 'items', label: '物品管理', href: '#/manage/items' },
                { id: 'catalog', label: '商品目录', href: '#/manage/catalog' },
                { id: 'locations', label: '位置与容器', href: '#/manage/locations' },
                { id: 'activity', label: '动态与历史', href: '#/manage/history' },
                { id: 'settings', label: '设置', href: '#/settings?mode=management' },
              ]
            : links
        }
        activePath={
          extended
            ? '#' +
              route.pathname +
              (route.pathname === '/settings' && mode === 'management' ? '?mode=management' : '')
            : page.id === 'page-daily-attention'
              ? '#/attention'
              : page.id === 'page-daily-activity'
                ? '#/activity'
                : '#/items'
        }
        onNavigate={(href) => navigate(href.replace(/^#/, ''))}
        householdId={householdId}
        households={[{ id: householdId, name: '梧桐之家 · 示例' }]}
        householdBlockedReason="此预览固定在示例家庭；账号与家庭页可审阅切换意图"
        onHouseholdSwitchIntent={() => navigate('/settings/household')}
        recoveredTask={
          pendingPath && !taskKind ? (
            <Button variant="secondary" onClick={() => navigate(pendingPath!)}>
              有待确认任务 · 继续核对原请求
            </Button>
          ) : undefined
        }
        headerActions={
          <Button variant="quiet" onClick={() => navigate('/daily/scan')}>
            扫码
          </Button>
        }
        title={page.name.replace('页面 · ', '')}
      >
        {route.pathname.startsWith('/daily/') ? (
          <DailyExtrasJourney path={route.href} scenario={scenario} navigate={navigate} />
        ) : route.pathname.startsWith('/manage/') ? (
          <ManagementJourney path={route.href} scenario={scenario} navigate={navigate} />
        ) : route.pathname.startsWith('/settings') ? (
          <SettingsJourney path={route.href} scenario={scenario} navigate={navigate} />
        ) : taskKind ? (
          <TaskJourney
            key={`${taskKind}:${params.get('target') || ''}:${params.get('taskScenario') || scenario}`}
            kind={taskKind}
            onSwitch={(kind) => navigate(`/tasks/${kind}`)}
            scenario={params.get('taskScenario') || scenario}
            target={params.get('target') || undefined}
            onBack={back}
          />
        ) : page.id === 'page-daily-attention' ? (
          <DailyAttention
            {...common}
            tasks={taskPage.data}
            stocks={stockPage.data}
            onOpenProduct={browse.onOpenProduct}
            dateRange={dateRange}
            onDateRangeChange={(value) => update({ range: value, page: null })}
            category={category}
            onCategoryChange={(value) => update({ category: value, page: null })}
            pagination={category === 'stock' ? stockPage.pagination : taskPage.pagination}
            familyTimezone="Asia/Shanghai"
            asOf="2026-11-07"
            onOpenItem={browse.onOpenItem}
          />
        ) : page.id === 'page-daily-activity' ? (
          <DailyActivity
            {...common}
            entries={activityPage.data.map((entry) => ({
              ...entry,
              operationComplete: state !== 'offline-partial',
              recordedDayLabel: entry.event
                ? new Intl.DateTimeFormat('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  }).format(new Date(entry.event.recorded_at))
                : '日期未知',
            }))}
            rangeLabel="截至 2026-11-07 · Asia/Shanghai"
            days={params.get('days') === '30' ? '30' : '7'}
            onDaysChange={(value) => update({ days: value, page: null })}
            filter={activityFilter}
            onFilterChange={(value) => update({ filter: value, page: null })}
            pagination={activityPage.pagination}
            onOpenItemHistory={(id) => navigate(`/items/${id}?tab=history`)}
          />
        ) : page.id === 'page-daily-home' ? (
          <DailyHome {...browse} />
        ) : page.id === 'page-daily-search' ? (
          <DailySearch {...browse} />
        ) : page.id === 'page-daily-product' ? (
          <DailyProduct
            {...common}
            state={missingState(product)}
            product={product}
            onTask={browse.onTask}
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
            onTask={browse.onTask}
            onNavigate={navigate}
            product={product}
            notes={extraNotes ?? (facts?.item.id === firstItemId ? notes : [])}
            history={history.filter((e) => e.event?.target_id === facts?.item.id)}
            tab={tab}
            onTabChange={(next) => update({ tab: next }, route.pathname, true)}
            onOpenProduct={browse.onOpenProduct}
            onBack={back}
          />
        )}
      </AppShell>
      <ReviewNote>
        P01–P08 隔离页面候选。固定家庭时区 Asia/Shanghai，样例日期判断基准为
        2026-11-07。每页意见随当前路由归档；反馈只写入本地审阅目录。读取失败、无权限与离线无缓存分别展示，均不解释为零库存。正式服务、认证、上传、扫码及打印设备尚未接通。
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
    const routes = [
      '/items',
      '/search',
      '/tasks/$kind',
      '/daily/$section',
      '/manage/$section',
      '/settings',
      '/settings/$section',
      '/attention',
      '/activity',
      '/items/$itemId',
      '/products/$productId',
    ].map((path) => createRoute({ getParentRoute: () => root, path, component: PageScreen }));
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
