import { App, Button } from 'antd';
import type { FunctionComponent } from 'react';
import type { RouterHistory } from '@tanstack/react-router';
import { embeddedRuntime } from './lib/runtime';
import { itemName, locationName, ancestors } from '../../../packages/contracts/src/web';
import { useEffect, useState } from 'react';
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
import { Home, Product, ItemDetail, Catalog, Settings, History, Notes } from './pages';
import { ActionSheet, type Action } from './ui/forms';
import { Empty, Notice } from './ui/components';
import { clearBrowseSelections, InventorySearch, ProductCatalog } from './ui/browser';
import { clearWorkbenchSelections, Workbench, WorkbenchShell } from './ui/workbench';
export function Workspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data, stale, refresh, cacheWarning } = useInventory();
  const { session, online, expired, requestLogin, storageError } = useSession();
  const { message } = App.useApp();
  useEffect(() => {
    // Clear every list, including an unmounted SKU view, when the host changes households.
    clearBrowseSelections();
    clearWorkbenchSelections();
  }, [session.cache_key]);
  const [selectionVersion, resetSelection] = useState(0);
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
  if (section === 'items')
    page =
      id === 'group' ? (
        <Product id={parts[2]} open={open} />
      ) : id ? (
        parts[2] === 'history' ? (
          <History id={id} />
        ) : parts[2] === 'notes' ? (
          <Notes id={id} open={open} />
        ) : parts[2] === 'details' ? (
          <ItemDetail id={id} open={open} />
        ) : (
          <Workbench
            selectionVersion={selectionVersion}
            key={`${session.cache_key}:${scope ?? ''}`}
            id={scope}
            detailId={id}
            open={open}
          />
        )
      ) : (
        <Workbench
          selectionVersion={selectionVersion}
          key={`${session.cache_key}:root`}
          open={open}
        />
      );
  else if (section === 'places')
    page = (
      <Workbench
        selectionVersion={selectionVersion}
        key={`${session.cache_key}:${id ?? ''}`}
        id={id}
        open={open}
      />
    );
  else if (section === 'search') page = <InventorySearch />;
  else if (section === 'catalog')
    page =
      parts[2] === 'history' ? (
        <History id={id} kind="CATALOG_NODE" />
      ) : id ? (
        <Catalog id={id === 'manage' ? undefined : id} open={open} />
      ) : (
        <ProductCatalog open={open} />
      );
  else if (section === 'settings') page = <Settings section={id} />;
  else if (section === 'login') page = <Home open={open} />;
  else
    page = (
      <Empty title="页面不存在">
        <Link to="/items">返回我的物品</Link>
      </Empty>
    );
  return (
    <WorkbenchShell section={section}>
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
      {page}
      {action && (
        <ActionSheet
          key={JSON.stringify(action)}
          action={action}
          onClose={close}
          onCreateProduct={() => open({ kind: 'catalog', from: 'intake' })}
          onSaved={(result) => {
            const first = result.affected_objects[0];
            if (action.kind === 'move') resetSelection((v) => v + 1);
            void message.success('已保存，库存和历史已更新');
            if (action.kind === 'catalog' && action.from === 'intake' && first) {
              open({ kind: 'intake', target: first.id });
              return;
            }
            if (action.kind === 'intake' && first) {
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
    </WorkbenchShell>
  );
}
export function workspaceRouter(component: FunctionComponent, history?: RouterHistory) {
  const rootRoute = createRootRoute({ component });
  const index = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
  const catchAll = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    component: () => null,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([index, catchAll]),
    history,
    scrollRestoration: true,
  });
}
