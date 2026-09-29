import { startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser';
export type Capabilities = { registration: boolean; recovery: boolean; passkey: boolean };
export async function accountRequest<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/auth/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? '操作过于频繁，请稍后重试。'
        : typeof data.message === 'string' && /[\u3400-\u9fff]/.test(data.message)
          ? data.message
          : '请求失败，请检查登录状态后重试。',
    );
  return data;
}
export async function signInPasskey() {
  if (!window.PublicKeyCredential) throw new Error('此浏览器暂不支持通行密钥，请使用邮箱和密码。');
  const options = await accountRequest('passkey/generate-authenticate-options');
  const response = await startAuthentication({ optionsJSON: options });
  return accountRequest('passkey/verify-authentication', { response });
}
export async function addPasskey(name = '通行密钥', enrollment = false) {
  if (!window.PublicKeyCredential) throw new Error('此浏览器暂不支持通行密钥，请使用邮箱和密码。');
  const options = await accountRequest('account/passkey/options', { enrollment });
  const response = await startRegistration({ optionsJSON: options });
  return accountRequest('account/passkey/complete', { response, name });
}
export function authError(error: unknown) {
  if (error instanceof WebAuthnError) {
    if (error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')
      return '此设备已有这个账号的通行密钥。请用已有密钥登录，或选择其他设备创建。';
    if (
      error.code === 'ERROR_CEREMONY_ABORTED' ||
      (error.cause instanceof Error && error.cause.name === 'NotAllowedError')
    )
      return '已取消通行密钥操作，可以重试或使用密码。';
    return '无法完成通行密钥操作，请重试、选择其他设备或使用密码。';
  }
  if (error instanceof Error && ['NotAllowedError', 'AbortError'].includes(error.name))
    return '已取消通行密钥操作，可以重试或使用密码。';
  return error instanceof Error ? error.message : '操作失败，请重试。';
}
export function enrollmentReturnSearch() {
  if (['/login', '/register', '/recover'].includes(location.pathname)) return location.search;
  return '?returnTo=' + encodeURIComponent(location.pathname + location.search);
}
