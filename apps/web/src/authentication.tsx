import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionGate } from './lib/session';
import { EnrollmentScreen } from './accounts';
import { AuthScreen } from './auth';
import './product.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    {['/register', '/recover'].includes(location.pathname) ? (
      <EnrollmentScreen />
    ) : (
      <SessionGate view="auth">
        <AuthScreen />
      </SessionGate>
    )}
  </QueryClientProvider>,
);
