import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { request } from './api';
import {
  clearPrivateData,
  clearHouseholdData,
  invalidatePendingStorage,
  persist,
  stored,
} from './storage';
import { authPost, loginURL, Redirect, serverRedirect } from './auth';
import {
  accountRequest,
  signInPasskey,
  authError,
  enrollmentReturnSearch,
  type Capabilities,
} from './accounts';
import { FamilySetup } from '../accounts';
import { Button, Field, Notice, Sheet } from '../ui/components';

export interface Session {
  mode: 'local' | 'cloud';
  authenticated: boolean;
  cache_key?: string;
  email?: string;
  user_id?: string;
  household_id?: string;
  login_methods?: { password: boolean; passkey_count: number };
  households?: { id: string; household_id: string; name: string }[];
}
const Context = createContext<{
  session: Session;
  online: boolean;
  expired: boolean;
  requestLogin: () => void;
  logout: () => Promise<void>;
  storageError: string;
  switchHousehold: (id: string) => Promise<void>;
}>(null!);
export const useSession = () => useContext(Context);
export function Login({
  onDone,
  oauthQuery,
  expectedEmail,
}: {
  onDone: () => Promise<void>;
  oauthQuery?: string;
  expectedEmail?: string;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [passwordMode, setPasswordMode] = useState(false);
  const [cap, setCap] = useState<Capabilities>();
  useEffect(() => {
    void accountRequest<Capabilities>('account/capabilities')
      .then(setCap)
      .catch(() => {});
  }, []);
  async function done() {
    if (expectedEmail) {
      const current = await request<Session>('/api/session');
      if (current.email !== expectedEmail) {
        await clearPrivateData();
        location.replace('/login');
        return;
      }
    }
    if (oauthQuery) {
      serverRedirect(
        await authPost('oauth2/continue', { selected: true, oauth_query: oauthQuery }),
      );
      return;
    }
    await onDone();
  }
  return (
    <div className="stack">
      <Button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await signInPasskey();
            await done();
          } catch (e) {
            setError(authError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        使用通行密钥登录
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => setPasswordMode(!passwordMode)}
      >
        使用邮箱和密码
      </Button>
      {passwordMode && (
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
              await done();
            } catch (err) {
              setError(err instanceof Error ? err.message : '登录失败，请重试。');
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="邮箱">
            <input
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={expectedEmail}
              readOnly={!!expectedEmail}
              required
            />
          </Field>
          <Field label="密码">
            <input name="password" type="password" autoComplete="current-password" required />
          </Field>
          <Button disabled={busy}>{busy ? '正在登录…' : '登录'}</Button>
        </form>
      )}
      {error && <Notice danger>{error}</Notice>}
      {!expectedEmail && (
        <>
          <a href={'/register' + enrollmentReturnSearch()}>
            {cap?.registration ? '创建账号' : '查看注册状态'}
          </a>
          <a href={'/recover' + enrollmentReturnSearch()}>找回账号</a>
        </>
      )}
    </div>
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
      if (session?.cache_key && session.cache_key !== current.cache_key) {
        await client.cancelQueries();
        invalidatePendingStorage();
        client.clear();
      }
      if (session?.user_id === current.user_id && current.user_id) {
        for (const old of session?.households ?? [])
          if (!current.households?.some((h) => h.household_id === old.household_id))
            await clearHouseholdData(current.user_id, old.household_id);
      }
      const prior = localStorage.getItem('acornary-account');
      if (
        prior &&
        prior !== (current.user_id ?? current.cache_key) &&
        prior !== current.cache_key
      ) {
        await clearPrivateData();
        client.clear();
      }
      localStorage.setItem('acornary-account', current.user_id ?? current.cache_key);
      if (current.household_id) {
        sessionStorage.setItem('acornary-household', current.household_id);
        localStorage.setItem('acornary-last-household', current.household_id);
      } else sessionStorage.removeItem('acornary-household');
      try {
        await persist('session', current);
        if (current.household_id) await persist('session:' + current.household_id, current);
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
        const household =
          sessionStorage.getItem('acornary-household') ??
          localStorage.getItem('acornary-last-household');
        const cached = await stored<Session>(household ? 'session:' + household : 'session');
        if (
          view === 'product' &&
          cached?.cache_key &&
          localStorage.getItem('acornary-account') === (cached.user_id ?? cached.cache_key)
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
    window.addEventListener('acornary-refresh-session', connected);
    window.addEventListener('offline', disconnected);
    window.addEventListener('acornary-session-expired', invalid);
    window.addEventListener('storage', crossTab);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', connected);
      window.removeEventListener('acornary-refresh-session', connected);
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
      window.location.replace('/login');
    } catch (error) {
      loggingOut.current = false;
      throw error;
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
        switchHousehold: async (id) => {
          await client.cancelQueries();
          invalidatePendingStorage();
          client.clear();
          sessionStorage.setItem('acornary-household', id);
          window.location.assign('/items');
        },
      }}
    >
      {session.mode === 'cloud' && !session.household_id && (view !== 'auth' || !!oauthQuery) ? (
        <FamilySetup onDone={check} />
      ) : view === 'inspector' && !online ? (
        <main className="auth-panel">
          <h1>数据库检查器需要联网</h1>
          <p>此处不保存离线记录。</p>
          <a href="/items">返回松仓</a>
        </main>
      ) : (
        <div key={session.cache_key}>{children}</div>
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
