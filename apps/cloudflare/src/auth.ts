import { betterAuth } from 'better-auth';
import { passkey } from '@better-auth/passkey';
import { APIError } from 'better-auth/api';
import { accountsPlugin } from './accounts.js';
import { Memberships } from './memberships.js';
import { jwt } from 'better-auth/plugins';
import { mcp } from '@better-auth/mcp';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from './cimd-fetch.js';
import type { Env } from './environment.js';
import { terminalPrefix } from '../../../packages/contracts/src/terminal.js';

export const inventoryScopes = ['inventory:read', 'inventory:write'] as const;
export function createAuth(env: Env) {
  const config = { origin: env.ORIGIN, secret: env.AUTH_SECRET, resource: env.ORIGIN + '/mcp' };
  const memberships = new Memberships(env);
  const activeUser = (id: string) => memberships.accounts.principal(id);
  const oauthMembership = (session: string, user: string) =>
    memberships.oauthMembership(session, user);
  const tokenContext = (user: string, reference?: string) =>
    memberships.tokenContext(user, reference);
  return betterAuth({
    appName: 'Acornary',
    baseURL: config.origin,
    basePath: '/api/auth',
    secret: config.secret,
    database: env.AUTH_DB,
    user: {
      additionalFields: {
        enabled: { type: 'boolean', defaultValue: true, input: false },
        auth_version: { type: 'number', defaultValue: 0, input: false },
      },
    },
    logger: { disabled: true },
    // Let the ingress sanitize unexpected errors; Better Call otherwise logs raw adapter errors.
    onAPIError: { throw: true },
    trustedOrigins: [config.origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: true,
      cookiePrefix: 'acornary-' + env.ENVIRONMENT,
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = await activeUser(session.userId);
            if (!user) return false;
          },
        },
      },
    },
    plugins: [
      jwt(),
      accountsPlugin(env),
      passkey({
        rpID: new URL(config.origin).hostname,
        rpName: '松仓',
        origin: config.origin,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        authentication: {
          afterVerification: async ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) throw new APIError('UNAUTHORIZED');
          },
        },
      }),
      mcp({
        resource: config.resource,
        resources: [
          {
            identifier: config.origin + terminalPrefix,
            allowedScopes: ['openid', 'offline_access', ...inventoryScopes],
            accessTokenTtl: 300,
          },
        ],
        loginPage: '/login',
        consentPage: '/consent',
        scopes: ['openid', 'profile', 'email', 'offline_access', ...inventoryScopes],
        grantTypes: ['authorization_code', 'refresh_token'],
        accessTokenExpiresIn: 300,
        refreshTokenExpiresIn: 30 * 24 * 60 * 60,
        refreshTokenReuseInterval: 0,
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        clientPrivileges: async () => false,
        postLogin: {
          page: '/choose-household',
          shouldRedirect: async ({ session, user }) =>
            !(await oauthMembership(session.id, user.id)),
          consentReferenceId: async ({ session, user }) => {
            const member = await oauthMembership(session.id, user.id);
            const account = await activeUser(user.id);
            if (!member || !account) throw new APIError('FORBIDDEN');
            return `${member.id}:${account.auth_version}`;
          },
        },
        customAccessTokenClaims: async ({ user, referenceId }) => {
          const context = user && (await tokenContext(user.id, referenceId));
          if (!context) throw new APIError('FORBIDDEN');
          return { acornary_reference: referenceId };
        },
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;
