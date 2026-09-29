import { useEffect, useState } from 'react';
import { Button, Field, Notice, Sheet } from './ui/components';
import { accountRequest, addPasskey, authError, type Capabilities } from './lib/accounts';
import { Login, useSession } from './lib/session';
import { clearHouseholdData } from './lib/storage';

export function EnrollmentScreen() {
  const recovery = location.pathname === '/recover';
  const purpose = recovery ? 'recover' : 'register';
  const [cap, setCap] = useState<Capabilities>();
  const [step, setStep] = useState<'email' | 'code' | 'credential' | 'optional'>('email');
  const [email, setEmail] = useState('');
  const [passwordMode, setPasswordMode] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    void accountRequest<Capabilities>('account/capabilities')
      .then(setCap)
      .catch((e) => setError(authError(e)));
  }, []);
  const next = () => location.replace('/login' + location.search);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }
  const enabled = cap && (recovery ? cap.recovery : cap.registration);
  return (
    <main className="login">
      <img src="/app-icon.png" alt="松仓" width="76" height="76" />
      <h1>{recovery ? '找回松仓账号' : '创建松仓账号'}</h1>
      {!cap ? (
        <p>正在检查…</p>
      ) : !enabled ? (
        <Notice>
          {recovery
            ? '暂未开放邮箱找回，请使用已有登录方式。'
            : '暂未开放注册。已有账号可继续登录。'}
        </Notice>
      ) : (
        <>
          {step === 'email' && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await accountRequest('account/email/start', { email, purpose });
                  setStep('code');
                });
              }}
            >
              <p>
                {recovery
                  ? '验证邮箱后，你可以设置新的通行密钥或密码。旧登录方式与客户端授权将被撤销。'
                  : '用邮箱识别账号，再通过系统通行密钥登录。密码可以稍后添加，也可以不设置。'}
              </p>
              <Field label="邮箱">
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              <Button disabled={busy}>发送验证码</Button>
            </form>
          )}
          {step === 'code' && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                const code = new FormData(e.currentTarget).get('code');
                void run(async () => {
                  await accountRequest('account/email/verify', { code, purpose });
                  setStep('credential');
                });
              }}
            >
              <p>如果 {email} 符合条件，验证码已发送；10 分钟内有效。</p>
              <Field label="邮箱验证码">
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
              </Field>
              <Button disabled={busy}>验证邮箱</Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await accountRequest('account/email/start', { email, purpose });
                  })
                }
              >
                重新发送
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setStep('email')}
              >
                更换邮箱
              </Button>
            </form>
          )}
          {step === 'credential' && (
            <div className="stack">
              <p>邮箱已验证。请选择登录方式。</p>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await addPasskey('通行密钥', true);
                    recovery ? next() : setStep('optional');
                  })
                }
              >
                创建通行密钥
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setPasswordMode(!passwordMode)}
              >
                改用邮箱和密码
              </Button>
              {passwordMode && (
                <PasswordForm
                  busy={busy}
                  label="设置密码并继续"
                  onSubmit={(password) =>
                    run(async () => {
                      await accountRequest('account/complete-password', { password });
                      next();
                    })
                  }
                />
              )}
            </div>
          )}
          {step === 'optional' && (
            <div className="stack">
              <h2>需要添加密码吗？</h2>
              <p>通行密钥已经可以登录。密码是另一种可选的登录方式。</p>
              <PasswordForm
                busy={busy}
                label="设置密码"
                onSubmit={(password) =>
                  run(async () => {
                    await accountRequest('account/password', { password });
                    next();
                  })
                }
              />
              <Button variant="secondary" disabled={busy} onClick={next}>
                暂时跳过
              </Button>
            </div>
          )}
        </>
      )}
      {error && <Notice danger>{error}</Notice>}
      <a href={'/login' + location.search}>返回登录</a>
    </main>
  );
}
function PasswordForm({
  busy,
  label,
  onSubmit,
}: {
  busy: boolean;
  label: string;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [error, setError] = useState('');
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get('password') !== f.get('confirm')) {
          setError('两次密码不一致。');
          return;
        }
        setError('');
        void onSubmit(String(f.get('password')));
      }}
    >
      <Field label="新密码" hint="至少 12 位">
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
      <Field label="再次输入密码">
        <input
          type="password"
          name="confirm"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
      {error && <Notice danger>{error}</Notice>}
      <Button disabled={busy}>{label}</Button>
    </form>
  );
}
export function FamilySetup({ onDone }: { onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <main className="login">
      <h1>你的第一个家庭</h1>
      <p>创建家庭，或打开家人分享的邀请链接加入已有家庭。</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get('name');
          setBusy(true);
          void accountRequest('account/household', { action: 'create', name })
            .then(async (r) => {
              sessionStorage.setItem('acornary-household', r.household_id);
              await onDone();
            })
            .catch((e) => setError(authError(e)))
            .finally(() => setBusy(false));
        }}
      >
        <Field label="家庭名称">
          <input name="name" defaultValue="我的家庭" maxLength={80} required />
        </Field>
        <Button disabled={busy}>创建家庭</Button>
      </form>
      {error && <Notice danger>{error}</Notice>}
    </main>
  );
}
export function JoinScreen() {
  const token = new URLSearchParams(location.search).get('token');
  const [name, setName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void accountRequest('account/invitation', { token })
      .then((r) => setName(r.name))
      .catch((e) => setError(authError(e)));
  }, [token]);
  return (
    <main className="login">
      <h1>加入家庭</h1>
      {name && (
        <>
          <p>加入「{name}」后，你可以查看和管理这个家庭的全部库存，权限与其他成员相同。</p>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void accountRequest('account/household', { action: 'join', token })
                .then((r) => {
                  sessionStorage.setItem('acornary-household', r.household_id);
                  location.replace('/items');
                })
                .catch((e) => {
                  setError(authError(e));
                  setBusy(false);
                });
            }}
          >
            确认加入 {name}
          </Button>
        </>
      )}
      {error && <Notice danger>{error}</Notice>}
      <a href="/items">返回松仓</a>
    </main>
  );
}
export function AccountSettings() {
  const { session, online } = useSession();
  const [credentials, setCredentials] = useState<any>(),
    [reauth, setReauth] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [password, setPassword] = useState(false);
  const refresh = async () => setCredentials(await accountRequest('account/credentials'));
  useEffect(() => {
    if (online) void refresh().catch((e) => setError(authError(e)));
  }, [online]);
  async function act(fn: () => Promise<any>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await refresh();
      setMessage('已保存。');
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack">
      <h2>账号与安全</h2>
      <p>{session.email}</p>
      <p>
        {credentials?.password ? '已设置密码' : '未设置密码'} · {credentials?.passkeys.length ?? 0}{' '}
        个通行密钥
      </p>
      {credentials && !credentials.fresh && <Notice>修改登录方式前，请重新验证身份。</Notice>}
      <Button variant="secondary" disabled={!online || busy} onClick={() => setReauth(true)}>
        重新验证身份
      </Button>
      <Button
        disabled={!online || busy || !credentials?.fresh}
        onClick={() => void act(() => addPasskey())}
      >
        添加通行密钥
      </Button>
      {credentials?.passkeys.map((key: any) => (
        <div className="grouped stack" key={key.id}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get('name');
              void act(() => accountRequest('account/passkey/update', { id: key.id, name }));
            }}
          >
            <Field label="通行密钥名称">
              <input name="name" defaultValue={key.name ?? '通行密钥'} maxLength={80} required />
            </Field>
            <small>添加于 {new Date(key.createdAt).toLocaleDateString()}</small>
            <Button variant="secondary" disabled={!online || busy || !credentials.fresh}>
              保存名称
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={
                !online ||
                busy ||
                !credentials.fresh ||
                (!credentials.password && credentials.passkeys.length === 1)
              }
              onClick={() => {
                if (window.confirm('删除这个通行密钥？'))
                  void act(() =>
                    accountRequest('account/passkey/update', { id: key.id, name: null }),
                  );
              }}
            >
              删除通行密钥
            </Button>
          </form>
        </div>
      ))}
      <Button
        variant="secondary"
        disabled={!online || busy || !credentials?.fresh}
        onClick={() => setPassword(!password)}
      >
        {credentials?.password ? '修改密码' : '添加密码'}
      </Button>
      {password && (
        <PasswordForm
          busy={busy || !online}
          label="保存密码"
          onSubmit={(p) =>
            act(async () => {
              await accountRequest('account/password', { password: p });
              setPassword(false);
            })
          }
        />
      )}
      {credentials?.password && (
        <Button
          variant="danger"
          disabled={!online || busy || !credentials.fresh || !credentials.passkeys.length}
          onClick={() => {
            if (window.confirm('移除密码后将使用通行密钥登录，继续吗？'))
              void act(() => accountRequest('account/password', { password: null }));
          }}
        >
          移除密码
        </Button>
      )}
      <small>修改密码会退出其他会话，并要求已连接的客户端重新授权。</small>
      {message && <Notice>{message}</Notice>}
      {error && <Notice danger>{error}</Notice>}
      {reauth && (
        <Sheet title="验证你的身份" onClose={() => setReauth(false)}>
          <Login
            expectedEmail={session.email}
            onDone={async () => {
              await refresh();
              setReauth(false);
            }}
          />
        </Sheet>
      )}
    </section>
  );
}
export function HouseholdSettings() {
  const { session, online, switchHousehold } = useSession();
  const [detail, setDetail] = useState<any>(),
    [error, setError] = useState(''),
    [link, setLink] = useState(''),
    [busy, setBusy] = useState(false);
  const household_id = session.household_id;
  const refresh = async () =>
    setDetail(await accountRequest('account/household', { action: 'members', household_id }));
  useEffect(() => {
    if (online) void refresh().catch((e) => setError(authError(e)));
  }, [household_id, online]);
  async function act(body: any) {
    setBusy(true);
    setError('');
    try {
      const r = await accountRequest('account/household', { household_id, ...body });
      if (body.action !== 'leave') await refresh();
      else if (session.user_id && household_id)
        await clearHouseholdData(session.user_id, household_id);
      return r;
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack">
      <h2>家庭</h2>
      <Field label="当前家庭">
        <select
          value={household_id}
          disabled={!online || busy}
          onChange={(e) => void switchHousehold(e.target.value)}
        >
          {session.households?.map((h) => (
            <option value={h.household_id} key={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </Field>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get('name');
          void act({ action: 'rename', name }).then((r) => {
            if (r) location.reload();
          });
        }}
      >
        <Field label="家庭名称">
          <input
            name="name"
            defaultValue={session.households?.find((h) => h.household_id === household_id)?.name}
            required
            maxLength={80}
          />
        </Field>
        <Button variant="secondary" disabled={!online || busy}>
          修改家庭名称
        </Button>
      </form>
      <p>家庭成员 · 权限相同</p>
      <ul>
        {detail?.members.map((m: any) => (
          <li key={m.id}>
            {m.name} · {m.email}
          </li>
        ))}
      </ul>
      <Button
        disabled={!online || busy}
        onClick={() =>
          void act({ action: 'invite' }).then((r) => {
            if (r) setLink(r.url);
          })
        }
      >
        创建邀请链接
      </Button>
      {link && (
        <Field label="邀请链接" hint="请复制给家人。7 天有效、单次使用，持有链接的人可加入。">
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
        </Field>
      )}
      {detail?.invitations
        .filter((i: any) => !i.revoked && !i.used_by)
        .map((i: any) => (
          <div className="stack" key={i.id}>
            <small>邀请有效至 {new Date(i.expires_at).toLocaleString()}</small>
            <Button
              variant="secondary"
              disabled={!online || busy}
              onClick={() => void act({ action: 'revoke', invitation_id: i.id })}
            >
              撤销邀请
            </Button>
          </div>
        ))}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get('name');
          void act({ action: 'create', name }).then((r) => {
            if (r) void switchHousehold(r.household_id);
          });
        }}
      >
        <Field label="新家庭名称">
          <input name="name" maxLength={80} required placeholder="例如：另一处住所" />
        </Field>
        <Button variant="secondary" disabled={!online || busy}>
          创建另一个家庭
        </Button>
      </form>
      <Button
        variant="danger"
        disabled={!online || busy || !detail || detail.members.length < 2}
        onClick={() => {
          if (window.confirm('退出后无法再访问这个家庭及其库存，继续吗？'))
            void act({ action: 'leave' }).then((r) => {
              if (r) {
                sessionStorage.removeItem('acornary-household');
                location.replace('/items');
              }
            });
        }}
      >
        退出这个家庭
      </Button>
      {detail?.members.length === 1 && <small>最后一名成员不能退出家庭。</small>}
      {error && <Notice danger>{error}</Notice>}
    </section>
  );
}
