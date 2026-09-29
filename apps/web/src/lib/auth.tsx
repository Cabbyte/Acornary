import { useEffect } from 'react';

// Only product and inspector destinations are valid after ordinary sign-in.
// OAuth callbacks are handled exclusively by the OAuth server.
export function safeReturnTo(value: string | null): string {
  if (!value || /[\\\x00-\x20]/.test(value) || !value.startsWith('/') || value.startsWith('//'))
    return '/items';
  try {
    const url = new URL(value, 'https://return.invalid');
    if (
      url.origin !== 'https://return.invalid' ||
      !/^\/(items|places|catalog|settings|inspect|join)(\/|$)/.test(url.pathname)
    )
      return '/items';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/items';
  }
}
export function loginURL() {
  return (
    '/login?returnTo=' +
    encodeURIComponent(safeReturnTo(location.pathname + location.search + location.hash))
  );
}
export function Redirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return <p role="status">正在跳转…</p>;
}
export async function authPost(
  path: string,
  body: unknown,
): Promise<{ url?: string; redirect_uri?: string }> {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('acornary-session-expired'));
    throw new Error(
      response.status === 429
        ? '登录尝试过于频繁，请稍等一分钟后重试。'
        : path === 'sign-in/email' && !('oauth_query' in (body as object))
          ? '登录失败，请检查邮箱、密码及网络后重试。'
          : '授权未完成，请确认登录状态。若链接已过期，请回到客户端重新发起连接。',
    );
  }
  return data;
}
export function serverRedirect(result: { url?: string; redirect_uri?: string }) {
  // Never use redirect_uri from the browser query string here.
  const target = result.redirect_uri ?? result.url;
  if (!target) throw new Error('授权结果缺少返回地址，请从客户端重新连接。');
  window.location.assign(target);
}
