import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import type { PluginEnvelope } from '../../../packages/contracts/src/plugin';
import { Workspace, workspaceRouter } from './workspace';
import { InventoryProvider } from './lib/inventory';
import { SessionContext } from './lib/session';
import { installEmbeddedRuntime } from './lib/runtime';
import { PluginClient } from './plugin/client';
import { WidgetStore, type WidgetBridge } from './plugin/store';
import { Button, Notice } from './ui/components';

const connection = new PluginClient();
let store: WidgetStore;
const bridge = () => (window as Window & { openai?: WidgetBridge }).openai;
function InventoryApp({ envelope }: { envelope: PluginEnvelope }) {
  const [expired, setExpired] = useState(false);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );
  const [router] = useState(() =>
    workspaceRouter(
      () => (
        <InventoryProvider>
          <Workspace />
        </InventoryProvider>
      ),
      createMemoryHistory({ initialEntries: [store.route] }),
    ),
  );
  useEffect(() => {
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (
        document.visibilityState === 'hidden' ||
        queued ||
        client.isFetching({ queryKey: ['inventory'] })
      )
        return;
      queued = true;
      timer = setTimeout(() => {
        queued = false;
        void client.invalidateQueries({ queryKey: ['inventory', envelope.session.cache_key] });
      }, 150);
    };
    connection.onInvalidate = refresh;
    connection.onExpired = () => setExpired(true);
    const interval = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      connection.onInvalidate = () => {};
      connection.onExpired = () => {};
      void client.cancelQueries();
      client.clear();
    };
  }, [client, envelope.session.cache_key]);
  return (
    <QueryClientProvider client={client}>
      <SessionContext.Provider
        value={{
          session: envelope.session,
          online: !expired,
          expired,
          storageError: '',
          requestLogin: () => setExpired(true),
          logout: async () => setExpired(true),
          switchHousehold: async () => {},
        }}
      >
        {expired ? (
          <main className="loading">
            <Notice danger>
              连接授权已失效。请在 ChatGPT 中重新授权后重新打开插件。草稿未自动提交。
            </Notice>
          </main>
        ) : (
          <>
            {!envelope.session.can_write && <Notice>当前连接只有读取权限。</Notice>}
            <RouterProvider router={router} />
          </>
        )}
      </SessionContext.Provider>
    </QueryClientProvider>
  );
}
function PluginRoot({ initial }: { initial: PluginEnvelope }) {
  const [envelope, setEnvelope] = useState(initial);
  useEffect(() => {
    connection.onChange = (next) => {
      if (next.session.cache_key !== store.scope)
        store = new WidgetStore(bridge, next.session.cache_key);
      setEnvelope(next);
    };
    return () => {
      connection.onChange = () => {};
    };
  }, []);
  return <InventoryApp key={envelope.session.cache_key} envelope={envelope} />;
}
const root = createRoot(document.getElementById('root')!);
root.render(
  <main className="loading">
    <p role="status">正在连接松仓…</p>
  </main>,
);
void connection
  .connect()
  .then((initial) => {
    store = new WidgetStore(bridge, initial.session.cache_key);
    installEmbeddedRuntime({
      transport: connection,
      storage: { get: (key) => store.get(key), set: (key, value) => store.set(key, value) },
      select: (value) => connection.select(value),
      rememberRoute: (route) => {
        void store.rememberRoute(route).catch(() => {});
      },
    });
    root.render(<PluginRoot initial={initial} />);
  })
  .catch(() =>
    root.render(
      <main className="loading">
        <Notice danger>无法连接库存。请检查插件授权后重新打开。</Notice>
        <Button onClick={() => location.reload()}>重试连接</Button>
      </main>,
    ),
  );
