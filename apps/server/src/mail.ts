import nodemailer from 'nodemailer';
export type MailConfig =
  | { transport: 'disabled' }
  | { transport: 'test' }
  | {
      transport: 'smtp';
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
      from: string;
    };
export type AccountConfig = { mail: MailConfig; registration: boolean; recovery: boolean };
export const disabledAccounts: AccountConfig = {
  mail: { transport: 'disabled' },
  registration: false,
  recovery: false,
};
// Isolated tests only. This is never exposed by a production HTTP endpoint.
export const testMailbox: { to: string; code: string; purpose: string }[] = [];
export function accountConfig(env: NodeJS.ProcessEnv): AccountConfig {
  const transport = env.ACORNARY_MAIL_TRANSPORT ?? 'disabled';
  let mail: MailConfig;
  if (transport === 'disabled') mail = { transport };
  else if (transport === 'test') {
    if (
      env.NODE_ENV !== 'test' ||
      !/\/acornary_(test|e2e_\d+)$/.test(
        new URL(env.DATABASE_URL ?? 'postgres://localhost/invalid').pathname,
      )
    )
      throw new Error('Test mail requires an isolated test database and NODE_ENV=test.');
    mail = { transport };
  } else if (transport === 'smtp') {
    const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASSWORD: password, SMTP_FROM: from } = env;
    const port = Number(env.SMTP_PORT ?? 587);
    if (!host || !user || !password || !from || ![465, 587].includes(port))
      throw new Error('Complete SMTP configuration required (port 465 or 587).');
    mail = { transport, host, port, secure: port === 465, user, password, from };
  } else throw new Error('Unknown mail transport.');
  const flag = (key: string) => {
    if (env[key] && !['true', 'false'].includes(env[key]!)) throw new Error(`Invalid ${key}`);
    return env[key] === 'true';
  };
  const registration = flag('ACORNARY_REGISTRATION_ENABLED'),
    recovery = flag('ACORNARY_RECOVERY_ENABLED');
  if (mail.transport === 'disabled' && (registration || recovery))
    throw new Error('Email authentication requires a configured mail transport.');
  return { mail, registration, recovery };
}
export async function sendCode(config: MailConfig, to: string, code: string, purpose: string) {
  if (config.transport === 'disabled') throw new Error('Mail unavailable');
  if (config.transport === 'test') {
    testMailbox.push({ to, code, purpose });
    return;
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: true,
    disableFileAccess: true,
    disableUrlAccess: true,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  await transport.sendMail({
    from: config.from,
    to,
    subject: purpose === 'recover' ? '松仓账号恢复验证码' : '验证你的松仓邮箱',
    text: `验证码：${code}\n10 分钟内有效。如果不是你本人操作，请忽略此邮件。`,
  });
}
