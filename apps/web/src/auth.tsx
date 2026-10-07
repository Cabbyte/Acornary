import { Button, Select } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { authPost, Redirect, safeReturnTo, serverRedirect } from './lib/auth';
import { useSession } from './lib/session';
import { JoinScreen } from './accounts';
import { FormField, Notice } from './ui/components';
export function AuthScreen() {
  const { session } = useSession();
  const params = new URLSearchParams(location.search);
  const oauthQuery = params.has('client_id') ? location.search.slice(1) : undefined;
  const consent = location.pathname === '/consent';
  const choosing = location.pathname === '/choose-household';
  const flowKey =
    'acornary-oauth:' +
    JSON.stringify(['client_id', 'state', 'code_challenge'].map((k) => params.get(k)));
  const [household, setHousehold] = useState(
    sessionStorage.getItem(flowKey) ?? session.household_id ?? '',
  );
  const started = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(path: string, body: object) {
    setBusy(true);
    setError('');
    try {
      serverRedirect(
        await authPost(path, { ...body, household_id: household, oauth_query: oauthQuery }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '授权失败，请重试。');
      setBusy(false);
    }
  }
  useEffect(() => {
    if (oauthQuery && !consent && !choosing && !started.current) {
      started.current = true;
      // The provider verifies the signed context and rechecks session, client,
      // callback, PKCE and explicit prompt/max_age requirements.
      void act('oauth2/continue', { selected: true });
    }
  }, []);
  if (location.pathname === '/join') return <JoinScreen />;
  if (choosing && oauthQuery)
    return (
      <main className="login stack">
        <h1>选择授权的家庭</h1>
        <FormField label="家庭">
          <Select
            value={household}
            onChange={(e) => setHousehold(e)}
            options={[
              ...(session.households?.map((h) => ({ value: h.household_id, label: h.name })) ?? []),
            ]}
          />
        </FormField>
        <Button
          disabled={busy || !household}
          onClick={() => {
            sessionStorage.setItem(flowKey, household);
            void act('oauth2/continue', { postLogin: true });
          }}
          htmlType="button"
          type="primary"
        >
          继续授权
        </Button>
        {error && <Notice danger>{error}</Notice>}
      </main>
    );
  if (!oauthQuery && !consent) return <Redirect to={safeReturnTo(params.get('returnTo'))} />;
  const scopes: Record<string, string> = {
    openid: '确认账号身份',
    profile: '读取账号资料',
    email: '读取账号邮箱',
    'inventory:read': '读取库存、笔记及历史',
    'inventory:write': '修改库存与文字笔记',
    offline_access: '保持连接（刷新授权最长 30 天）',
  };
  return (
    <main className="login auth-consent">
      <img src="/app-icon.png" width="76" height="76" alt="松仓" />
      <h1>{consent ? '授权访问松仓' : '继续连接松仓'}</h1>
      <p>{session.email}</p>
      {consent && oauthQuery ? (
        <>
          <FormField label="授权家庭">
            <Select
              value={household}
              onChange={(e) => setHousehold(e)}
              options={[
                ...(session.households?.map((h) => ({ value: h.household_id, label: h.name })) ??
                  []),
              ]}
            />
          </FormField>
          <p>以下客户端请求访问所选家庭的库存：</p>
          <code className="oauth-client">{params.get('client_id')}</code>
          <ul>
            {(params.get('scope') ?? '')
              .split(' ')
              .filter(Boolean)
              .map((scope) => (
                <li key={scope}>{scopes[scope] ?? scope}</li>
              ))}
          </ul>
          <p>仅在你刚从 Codex、ChatGPT 或其他受信任客户端发起连接时允许。</p>
          <div className="stack">
            <Button
              htmlType="button"
              disabled={busy}
              onClick={() => void act('oauth2/consent', { accept: true })}
              type="primary"
            >
              允许
            </Button>
            <Button
              htmlType="button"
              disabled={busy}
              onClick={() => void act('oauth2/consent', { accept: false })}
              type="default"
            >
              拒绝
            </Button>
          </div>
        </>
      ) : (
        <Notice>
          {oauthQuery ? '正在验证授权请求…' : '缺少授权请求，请从客户端重新发起连接。'}
        </Notice>
      )}
      {error && <Notice danger>{error}</Notice>}
      <a className="button secondary" href="/items">
        返回松仓
      </a>
    </main>
  );
}
