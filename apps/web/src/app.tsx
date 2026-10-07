import { AcornaryUIProvider } from './ui/theme';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { SessionGate } from './lib/session';
import { InventoryProvider } from './lib/inventory';
import { Workspace, workspaceRouter } from './workspace';
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30000, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
const router = workspaceRouter(() => (
  <SessionGate>
    <InventoryProvider>
      <Workspace />
    </InventoryProvider>
  </SessionGate>
));
createRoot(document.getElementById('root')!).render(
  <AcornaryUIProvider>
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </AcornaryUIProvider>,
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
