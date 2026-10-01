import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Link,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';
import type { TemplateId } from '../../../packages/contracts/src/index';
import { SessionGate, useSession } from './lib/session';
import { InventoryProvider, useInventory } from './lib/inventory';
import { time } from './lib/presentation';
import { Home, Product, ItemDetail, Catalog, Settings, History, Notes } from './pages';
import { ActionSheet, type Action } from './ui/forms';
import { Button, Empty, Notice } from './ui/components';
import './product.css';
import { InventoryBrowser, InventorySearch, ProductCatalog } from './ui/browser';

const nav = [
  ['items', '我的物品'],
  ['catalog', '商品目录'],
  ['search', '搜索'],
  ['settings', '设置'],
];
function Workspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data, stale, refresh, cacheWarning } = useInventory();
  const { online, expired, requestLogin, storageError } = useSession();
  const [message, setMessage] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const parts = location.pathname.split('/').filter(Boolean);
  const section = parts[0] || 'items';
  const id = parts[1];
  const params = new URLSearchParams(location.searchStr);
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
    setMessage('');
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
        ) : (
          <ItemDetail id={id} open={open} />
        )
      ) : (
        <InventoryBrowser open={open} />
      );
  else if (section === 'places') page = <InventoryBrowser key={id ?? 'root'} id={id} open={open} />;
  else if (section === 'search') page = <InventorySearch />;
  else if (section === 'catalog')
    page =
      parts[2] === 'history' ? (
        <History id={id} kind="CATALOG_NODE" />
      ) : id ? (
        <Catalog id={id === 'manage' ? undefined : id} open={open} />
      ) : (
        <ProductCatalog />
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
    <div className="app-shell soft-shell">
      <a href="#main" className="skip-link">
        跳到内容
      </a>
      <header className="soft-topbar">
        <Link to="/items" className="brand">
          <span>
            <strong>松仓</strong>
          </span>
        </Link>
        <nav aria-label="主导航">
          {nav.map(([key, title]) => (
            <Link
              key={key}
              to={`/${key}`}
              aria-current={section === key ? 'page' : undefined}
              className={section === key ? 'active' : ''}
            >
              {title}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main" className="app-main">
        {expired && (
          <div className="status-banner">
            <Notice>登录已失效。缓存与输入已保留，重新登录后可继续操作。</Notice>
            <Button onClick={requestLogin}>重新登录</Button>
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
              variant="secondary"
              onClick={() =>
                void refresh()
                  .then(() => setConnectionError(''))
                  .catch(() => setConnectionError('连接仍不可用，已保留缓存和输入。'))
              }
            >
              重新连接
            </Button>
            {connectionError && <Notice danger>{connectionError}</Notice>}
          </div>
        )}
        {(storageError || cacheWarning) && <Notice danger>{storageError || cacheWarning}</Notice>}
        {page}
        {message && (
          <div className="toast" role="status">
            {message}
            <button aria-label="关闭提示" onClick={() => setMessage('')}>
              ×
            </button>
          </div>
        )}
      </main>
      <nav className="soft-mobile-nav" aria-label="底部导航">
        {nav.map(([key, title]) => (
          <Link
            key={key}
            to={`/${key}`}
            className={section === key ? 'active' : ''}
            aria-current={section === key ? 'page' : undefined}
          >
            <span>{title}</span>
          </Link>
        ))}
      </nav>
      {action && (
        <ActionSheet
          key={JSON.stringify(action)}
          action={action}
          onClose={close}
          onCreateProduct={() => open({ kind: 'catalog', from: 'intake' })}
          onSaved={(result) => {
            const first = result.affected_objects[0];
            setMessage('已保存，库存和历史已更新');
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
    </div>
  );
}
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30000, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
const rootRoute = createRootRoute({
  component: () => (
    <SessionGate>
      <InventoryProvider>
        <Workspace />
      </InventoryProvider>
    </SessionGate>
  ),
});
const index = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
const catchAll = createRoute({ getParentRoute: () => rootRoute, path: '$', component: () => null });
const router = createRouter({
  routeTree: rootRoute.addChildren([index, catchAll]),
  scrollRestoration: true,
});
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const register = () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Online operation remains available when browser storage is restricted. */
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
