import { PendingCatalogReviews } from './ui/catalog-review';
import { App, Button } from 'antd';
import type { FunctionComponent } from 'react';
import type { RouterHistory } from '@tanstack/react-router';
import { embeddedRuntime } from './lib/runtime';
import { itemName, locationName, ancestors } from '../../../packages/contracts/src/web';
import { lazy, Suspense, useEffect, useState } from 'react';
import { expandItemId } from './lib/labels';
import { LabelButton } from './ui/label-button';
import { PrinterProvider } from './lib/printer-context';
const LabelPrint = lazy(() => import('./ui/label-print'));
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';
import type { TemplateId } from '../../../packages/contracts/src/index';
import { useSession } from './lib/session';
import { useInventory } from './lib/inventory';
import { time } from './lib/presentation';
const KitchenSink = lazy(() => import('./features/ui-kitchen/KitchenSink'));
import { ActionSheet, type Action } from './ui/forms';
import { SettingsDetails } from './features/settings/SettingsDetails';
import { Empty, Notice } from './ui/components';
import { NextShell } from './next/NextShell';
import { ItemsScreen } from './features/items/screens/ItemsScreen';
const ItemScreen = lazy(() =>
  import('./next/screens/ItemScreen').then((module) => ({ default: module.ItemScreen })),
);
const CatalogScreen = lazy(() =>
  import('./next/screens/CatalogScreen').then((module) => ({ default: module.CatalogScreen })),
);
const ActivityScreen = lazy(() =>
  import('./next/screens/ActivityScreen').then((module) => ({ default: module.ActivityScreen })),
);
const SettingsScreen = lazy(() =>
  import('./next/screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })),
);
import { validateWorkspaceSearch } from './app/search';
export function Workspace() {
  const { session, expired } = useSession();
  return (
    <PrinterProvider
      key={`${session.cache_key ?? session.user_id ?? 'local'}:${expired}`}
      expired={expired}
    >
      <WorkspaceContent />
    </PrinterProvider>
  );
}
function WorkspaceContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data, stale, refresh, cacheWarning } = useInventory();
  const { session, online, expired, requestLogin, storageError } = useSession();
  const { message } = App.useApp();
  const [receipt, setReceipt] = useState<{ scope: string; ids: string[] }>();
  useEffect(() => setReceipt(undefined), [session.cache_key]);
  const [connectionError, setConnectionError] = useState('');
  const parts = location.pathname.split('/').filter(Boolean);
  const section = parts[0] || 'items';
  const id = parts[1];
  const params = new URLSearchParams(location.searchStr);
  const scope =
    section === 'places'
      ? id
      : section === 'items' && id && id !== 'group'
        ? (data.items.find((i) => i.id === id)?.parent_id ?? undefined)
        : undefined;
  const action = params.get('dialog')
    ? {
        kind: params.get('dialog')!,
        target: params.get('target') ?? undefined,
        template: params.get('template') as TemplateId | undefined,
        note: params.get('note') ?? undefined,
        parent: params.get('parent') ?? undefined,
        ids: params.get('ids') ?? undefined,
        from: params.get('from') ?? undefined,
      }
    : undefined;
  const compactId = section === 'i' && parts.length === 2 ? expandItemId(id ?? '') : undefined;
  useEffect(() => {
    if (compactId) void navigate({ to: `/items/${compactId}/details`, replace: true });
  }, [compactId, navigate]);
  const actionKeys = ['dialog', 'target', 'template', 'note', 'parent', 'ids', 'from'];
  const browseParams = Object.fromEntries([...params].filter(([key]) => !actionKeys.includes(key)));
  useEffect(() => {
    const runtime = embeddedRuntime();
    if (!runtime) return;
    const targetId = action?.target ?? params.get('item') ?? (id === 'group' ? parts[2] : id);
    const item = ['items', 'places'].includes(section)
      ? data.items.find((i) => i.id === targetId)
      : undefined;
    const catalog =
      section === 'catalog' || id === 'group'
        ? data.catalog.find((c) => c.id === targetId)
        : undefined;
    runtime.select(
      stale || expired
        ? null
        : item
          ? {
              kind: 'ITEM',
              id: item.id,
              revision: item.revision,
              name: itemName(item, data),
              location: locationName(item, data),
            }
          : catalog
            ? {
                kind: 'CATALOG_NODE',
                id: catalog.id,
                revision: catalog.revision,
                name: catalog.name,
                location: ancestors(catalog.parent_id, data.catalog)
                  .map((c) => c.name)
                  .join(' / '),
              }
            : null,
    );
    return () => runtime.select(null);
  }, [location.pathname, location.searchStr, data, stale, expired]);
  useEffect(() => {
    embeddedRuntime()?.rememberRoute?.(location.pathname + location.searchStr);
  }, [location.pathname, location.searchStr]);
  const open = (a: Action) =>
    void navigate({
      to: location.pathname,
      search: {
        ...browseParams,
        ...Object.fromEntries(
          Object.entries({ dialog: a.kind, ...a }).filter(
            ([k, v]) => k !== 'kind' && v !== undefined,
          ),
        ),
      },
    });
  const close = () => {
    const remaining = new URLSearchParams(location.searchStr);
    actionKeys.forEach((k) => remaining.delete(k));
    void navigate({ to: location.pathname, search: Object.fromEntries(remaining), replace: true });
  };
  useEffect(() => {
    message.destroy();
  }, [location.pathname]);
  let page;
  const legacyRedirect =
    section === 'i' && id
      ? `/items/${expandItemId(id)}`
      : section === 'items' && id && ['history', 'notes', 'details'].includes(parts[2] ?? '')
        ? `/items/${id}`
        : section === 'catalog' && id && parts[2] === 'history'
          ? `/catalog/${id}`
          : null;
  if (legacyRedirect) {
    void navigate({ to: legacyRedirect, replace: true });
    page = <Empty title="正在打开新页面…" />;
  } else if (section === 'items') {
    if (id === 'group') page = <ItemsScreen catalogId={parts[2]} open={open} />;
    else if (id) page = <ItemScreen id={id} open={open} />;
    else page = <ItemsScreen open={open} />;
  } else if (section === 'places') page = <ItemsScreen locationId={id} open={open} />;
  else if (section === 'search') page = <ItemsScreen open={open} searchMode />;
  else if (section === 'catalog') page = <CatalogScreen id={id} open={open} />;
  else if (section === 'activity') page = <ActivityScreen />;
  else if (section === 'settings')
    page = id ? <SettingsDetails section={id} /> : <SettingsScreen />;
  else if (section === 'ui')
    page = (
      <Suspense fallback={<p role="status">正在加载界面基线…</p>}>
        <KitchenSink />
      </Suspense>
    );
  else
    page = (
      <Empty title="页面不存在">
        <Link to="/items">返回我的物品</Link>
      </Empty>
    );
  const Shell = NextShell;
  return (
    <Shell section={section}>
      {expired && (
        <div className="status-banner">
          <Notice>登录已失效。缓存与输入已保留，重新登录后可继续操作。</Notice>
          <Button onClick={requestLogin} htmlType="button" type="primary">
            重新登录
          </Button>
        </div>
      )}
      {!expired && (stale || !online) && (
        <div className="status-banner">
          <Notice>
            离线查看 · 上次更新 {time(data.cached_at)}
            <br />
            已缓存目录、物品与笔记。修改需要联网。
          </Notice>
          <Button
            onClick={() =>
              void refresh()
                .then(() => setConnectionError(''))
                .catch(() => setConnectionError('连接仍不可用，已保留缓存和输入。'))
            }
            htmlType="button"
            type="default"
          >
            重新连接
          </Button>
          {connectionError && <Notice danger>{connectionError}</Notice>}
        </div>
      )}
      {(storageError || cacheWarning) && <Notice danger>{storageError || cacheWarning}</Notice>}
      {!action && <PendingCatalogReviews key={session.cache_key} />}
      {receipt?.scope === session.cache_key && receipt && (
        <div className="status-banner">
          <span>本次已入库 {receipt.ids.length} 件。</span>
          <LabelButton
            disabled={!online || stale}
            onClick={() => open({ kind: 'print', ids: receipt.ids.join(',') })}
          >
            打印本次入库标签
          </LabelButton>
          <Button type="text" onClick={() => setReceipt(undefined)}>
            关闭
          </Button>
        </div>
      )}
      <Suspense fallback={<p role="status">正在读取页面…</p>}>{page}</Suspense>
      {action?.kind === 'print' && (
        <Suspense fallback={<p role="status">正在准备标签预览…</p>}>
          <LabelPrint
            key={`${session.cache_key}:${action.ids ?? action.target ?? ''}`}
            ids={(action.ids ?? action.target ?? '').split(',').filter(Boolean)}
            onClose={close}
          />
        </Suspense>
      )}
      {action && action.kind !== 'print' && (
        <ActionSheet
          key={JSON.stringify(action)}
          action={action}
          onClose={close}
          onCreateProduct={() => open({ kind: 'catalog', from: 'intake' })}
          onSaved={(result) => {
            const first =
              action.kind === 'intake'
                ? result.affected_objects.find((o) => o.kind === 'ITEM')
                : result.affected_objects[0];
            void message.success('已保存，库存和历史已更新');
            if (action.kind === 'catalog' && action.from === 'intake' && first) {
              open({ kind: 'intake', target: first.id });
              return;
            }
            if (action.kind === 'intake' && first) {
              setReceipt({
                scope: session.cache_key!,
                ids: result.affected_objects.filter((o) => o.kind === 'ITEM').map((o) => o.id),
              });
              void navigate({ to: `/items/${first.id}`, replace: true });
              return;
            }
            if (action.kind === 'place' && first) {
              void navigate({ to: `/places/${first.id}`, replace: true });
              return;
            }
            if (action.kind === 'catalog' && first) {
              void navigate({ to: `/catalog/${first.id}`, replace: true });
              return;
            }
            close();
          }}
        />
      )}
    </Shell>
  );
}
export function workspaceRouter(component: FunctionComponent, history?: RouterHistory) {
  const rootRoute = createRootRoute({ component, validateSearch: validateWorkspaceSearch });
  const index = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
  const coreRoutes = [
    '/items',
    '/items/$id',
    '/items/$id/details',
    '/items/group/$catalogId',
    '/places/$id',
    '/search',
    '/catalog',
    '/catalog/$id',
    '/activity',
    '/settings',
    '/settings/account',
    '/settings/households',
    '/settings/printer',
  ].map((path) => createRoute({ getParentRoute: () => rootRoute, path, component: () => null }));
  const catchAll = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    component: () => null,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([index, ...coreRoutes, catchAll]),
    history,
    scrollRestoration: true,
  });
}
