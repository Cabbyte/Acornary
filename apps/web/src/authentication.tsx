import { AcornaryUIProvider } from './ui/theme';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionGate } from './lib/session';
import { EnrollmentScreen } from './accounts';
import { AuthScreen } from './auth';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <AcornaryUIProvider>
    <QueryClientProvider client={client}>
      {['/register', '/recover'].includes(location.pathname) ? (
        <EnrollmentScreen />
      ) : (
        <SessionGate view="auth">
          <AuthScreen />
        </SessionGate>
      )}
    </QueryClientProvider>
  </AcornaryUIProvider>,
);
