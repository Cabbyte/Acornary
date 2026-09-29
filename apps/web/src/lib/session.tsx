import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { request } from './api';
import { clearPrivateData, invalidatePendingStorage, persist, stored } from './storage';
import { authPost, loginURL, Redirect, serverRedirect } from './auth';
import { Button, Field, Notice, Sheet } from '../ui/components';

export interface Session {
  mode: 'local' | 'cloud';
  authenticated: boolean;
  cache_key?: string;
  email?: string;
}
const Context = createContext<{
  session: Session;
  online: boolean;
  expired: boolean;
  requestLogin: () => void;
  logout: () => Promise<void>;
  storageError: string;
}>(null!);
export const useSession = () => useContext(Context);
export function Login({
  onDone,
  oauthQuery,
}: {
  onDone: () => Promise<void>;
  oauthQuery?: string;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        const f = new FormData(e.currentTarget);
        try {
          const result = await authPost('sign-in/email', {
            email: f.get('email'),
            password: f.get('password'),
            ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
          });
          if (oauthQuery) {
            serverRedirect(result);
            return;
          }
          await onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : '登录失败，请重试。');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="邮箱">
        <input name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="密码">
        <input name="password" type="password" autoComplete="current-password" required />
      </Field>
      {error && <Notice danger>{error}</Notice>}
      <Button disabled={busy}>{busy ? '正在登录…' : '登录'}</Button>
    </form>
  );
}
export function SessionGate({
  children,
  view = 'product',
}: {
  children: ReactNode;
  view?: 'product' | 'inspector' | 'auth';
}) {
  const client = useQueryClient();
  const [session, setSession] = useState<Session>();
  const [online, setOnline] = useState(navigator.onLine);
  const [expired, setExpired] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const generation = useRef(0);
  const loggingOut = useRef(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const params = new URLSearchParams(window.location.search);
  const oauthQuery =
    view === 'auth' && params.has('client_id') ? window.location.search.slice(1) : undefined;
  // Honor an explicit OAuth reauthentication request; normal sessions skip passwords.
  const forceLogin =
    view === 'auth' &&
    location.pathname === '/login' &&
    !!oauthQuery &&
    ((params.get('prompt') ?? '').split(' ').includes('login') || params.has('max_age'));

  async function check() {
    if (loggingOut.current) return;
    const version = ++generation.current;
    const current = await request<Session>('/api/session');
    if (version !== generation.current) return;
    if (current.authenticated && current.cache_key) {
      const prior = localStorage.getItem('acornary-account');
      if (prior && prior !== current.cache_key) {
        await clearPrivateData();
        client.clear();
      }
      localStorage.setItem('acornary-account', current.cache_key);
      try {
        await persist('session', current);
      } catch {
        setStorageError('浏览器无法保存本地缓存；关闭页面后的离线内容可能不可用。');
      }
      if (version !== generation.current) return;
      setSession(current);
      setExpired(false);
      setShowLogin(false);
      setError('');
      await client.invalidateQueries({ queryKey: ['inventory'] });
    } else {
      if (session?.authenticated) {
        setExpired(true);
        setShowLogin(true);
      } else setSession(current);
    }
  }
  useEffect(() => {
    void check().catch(async () => {
      try {
        const cached = await stored<Session>('session');
        if (
          view === 'product' &&
          cached?.cache_key &&
          localStorage.getItem('acornary-account') === cached.cache_key
        ) {
          setSession(cached);
          setOnline(false);
          return;
        }
      } catch {
        /* No readable cache. */
      }
      setError('无法连接。尚无可用的登录缓存，请联网后重试。');
    });
  }, []);
  useEffect(() => {
    const connected = () => {
      setOnline(true);
      void check().catch(() => setOnline(false));
    };
    const disconnected = () => setOnline(false);
    const invalid = () => {
      setExpired(true);
      setShowLogin(true);
    };
    const visibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) connected();
    };
    const crossTab = (e: StorageEvent) => {
      if (e.key === 'acornary-account') {
        generation.current++;
        invalidatePendingStorage();
        client.clear();
        window.location.reload();
      }
    };
    const timer = window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible')
        void check().catch(() => setOnline(false));
    }, 30000);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    window.addEventListener('acornary-session-expired', invalid);
    window.addEventListener('storage', crossTab);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
      window.removeEventListener('acornary-session-expired', invalid);
      window.removeEventListener('storage', crossTab);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [session]);
  async function logout() {
    loggingOut.current = true;
    generation.current++;
    try {
      await request('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      client.clear();
      await clearPrivateData();
      setSession({ mode: 'cloud', authenticated: false });
      setExpired(false);
      setShowLogin(false);
      window.location.replace('/login');
    } finally {
      loggingOut.current = false;
    }
  }
  if (!session)
    return (
      <main className="login">
        <h1>松仓</h1>
        {error ? (
          <>
            <Notice danger>{error}</Notice>
            <Button onClick={() => window.location.reload()}>重试连接</Button>
          </>
        ) : (
          <p role="status">正在连接你的松仓…</p>
        )}
      </main>
    );
  if ((!session.authenticated || expired) && view === 'inspector')
    return <Redirect to={loginURL()} />;
  if (!session.authenticated && view === 'product') return <Redirect to={loginURL()} />;
  if (!session.authenticated || (view === 'auth' && (expired || forceLogin)))
    return (
      <main className="login">
        <img src="/app-icon.png" width="76" height="76" alt="松仓" />
        <h1>欢迎回到松仓</h1>
        <p>家里的每一件，都有迹可循。</p>
        <Login onDone={check} oauthQuery={oauthQuery} />
      </main>
    );
  return (
    <Context.Provider
      value={{
        session,
        online: online && !expired,
        expired,
        requestLogin: () => setShowLogin(true),
        logout,
        storageError,
      }}
    >
      {view === 'inspector' && !online ? (
        <main className="auth-panel">
          <h1>数据库检查器需要联网</h1>
          <p>此处不保存离线记录。</p>
          <a href="/items">返回松仓</a>
        </main>
      ) : (
        children
      )}
      {view === 'product' && expired && showLogin && (
        <Sheet title="重新登录" onClose={() => setShowLogin(false)}>
          <Notice>登录已失效，当前输入已保留。请重新登录后核对并继续。</Notice>
          <Login onDone={check} />
        </Sheet>
      )}
    </Context.Provider>
  );
}
