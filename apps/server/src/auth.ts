import { betterAuth } from 'better-auth';
import { passkey } from '@better-auth/passkey';
import { APIError } from 'better-auth/api';
import { accountsPlugin } from './accounts.js';
import { activeUser, legacyContext, oauthMembership, tokenContext } from './memberships.js';
import { jwt } from 'better-auth/plugins';
import { mcp } from '@better-auth/mcp';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import type { RuntimeConfig } from './config.js';
import { pool } from './db.js';
import type { Context } from './service.js';

export const inventoryScopes = ['inventory:read', 'inventory:write'] as const;
export function createAuth(config: Extract<RuntimeConfig, { mode: 'cloud' }>) {
  return betterAuth({
    appName: 'Acornary',
    baseURL: config.origin,
    basePath: '/api/auth',
    secret: config.secret,
    database: pool,
    logger: { disabled: true },
    trustedOrigins: [config.origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: true, ipAddress: { ipAddressHeaders: ['x-real-ip'] } },
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
            if (!user || !user.emailVerified) return false;
          },
        },
      },
    },
    plugins: [
      jwt(),
      accountsPlugin(config),
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
          return { acornary_reference: referenceId ?? `member_${user!.id}:0` };
        },
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;

// Compatibility for operational tooling and pre-migration owner tokens.
export const ownerContext = legacyContext;
