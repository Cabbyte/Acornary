import type { Auth } from './auth.js';
import type { Env } from './environment.js';
import { Memberships, oauthRequest, oauthFlow } from './memberships.js';
export const publicAuthPaths = new Set([
  '/sign-in/email',
  '/passkey/generate-authenticate-options',
  '/passkey/verify-authentication',
  '/account/capabilities',
  '/account/email/start',
  '/account/email/verify',
  '/account/complete-password',
  '/account/passkey/options',
  '/account/passkey/complete',
  '/account/credentials',
  '/account/password',
  '/account/passkey/update',
  '/account/households',
  '/account/household',
  '/account/invitation',
  '/sign-out',
  '/get-session',
  '/jwks',
  '/oauth2/authorize',
  '/oauth2/token',
  '/oauth2/consent',
  '/oauth2/continue',
  '/oauth2/revoke',
  '/oauth2/introspect',
  '/oauth2/userinfo',
  '/.well-known/openid-configuration',
  '/.well-known/oauth-authorization-server',
]);
export async function handleAuth(request: Request, env: Env, auth: Auth) {
  const url = new URL(request.url),
    path = url.pathname;
  if (path.startsWith('/api/auth/') && !publicAuthPaths.has(path.slice('/api/auth'.length)))
    return Response.json({ error: 'not_found' }, { status: 404 });
  let body: Record<string, unknown> = {};
  if (
    request.method === 'POST' &&
    request.headers.get('content-type')?.includes('application/json')
  ) {
    try {
      body = (await request.clone().json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'bad_request' }, { status: 400 });
    }
  }
  const flow = oauthFlow(
    typeof body.oauth_query === 'string' ? body.oauth_query : url.search.slice(1),
  );
  const memberships = new Memberships(env);
  if (
    typeof body.household_id === 'string' &&
    ['/api/auth/oauth2/continue', '/api/auth/oauth2/consent'].includes(path)
  ) {
    if (request.headers.get('origin') !== env.ORIGIN)
      return Response.json({ error: 'forbidden' }, { status: 403 });
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !(await memberships.accounts.principal(session.user.id)))
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    await memberships.select(session.session.id, session.user.id, flow, body.household_id);
  }
  return oauthRequest.run({ flow }, () => auth.handler(request));
}
