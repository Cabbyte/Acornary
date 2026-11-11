import { Button } from '../../../ui/components/ui/button';
import { Select } from '../../../ui/components/ui/select';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import { AlertDialog } from '../../../ui/components/ui/alert-dialog';
import { FormField } from '../../../ui/components/ui/form-field';
import { Input } from '../../../ui/components/ui/input';
import { SettingsFacts, SettingsLayout, SettingsLink, SettingsSection } from './settings-layout';
import type { AuthView, SettingsIdentity, SettingsPageProps } from './models';
export type AuthStatus =
  | 'idle'
  | 'passkey-cancelled'
  | 'password-error'
  | 'email-waiting'
  | 'email-failed'
  | 'recovery-complete'
  | 'invite-expired'
  | 'invite-accepted'
  | 'allowed'
  | 'denied'
  | 'reauthorization-required';
export type CredentialIntent =
  | { kind: 'rename-passkey' | 'remove-passkey'; key: string }
  | { kind: 'change-password' | 'remove-password' }
  | null;
export interface AccountSettingsPageProps extends SettingsPageProps {
  identity: SettingsIdentity;
  view: AuthView;
  status: AuthStatus;
  online: boolean;
  pendingCount: number;
  allowPendingLogout?: boolean;
  logoutOpen: boolean;
  onLogoutOpen: (open: boolean) => void;
  hostStorage: 'available' | 'unavailable';
  scopes: readonly string[];
  requestedWrite: boolean;
  onRequestedWrite: (value: boolean) => void;
  returnPath: string;
  registrationAvailable: boolean;
  recoveryAvailable: boolean;
  credentialsAvailable: boolean;
  secretFlowsAvailable: boolean;
  connectionLabel: string;
  credentialIntent: CredentialIntent;
  credentialName: string;
  onCredentialName: (name: string) => void;
  onCredentialIntent: (intent: CredentialIntent) => void;
  onConfirmCredential: () => void;
  onAction: (
    action:
      | 'passkey'
      | 'password'
      | 'add-passkey'
      | 'recovery-email'
      | 'recovery-retry'
      | 'recovery-complete'
      | 'accept-invite'
      | 'oauth-allow'
      | 'oauth-deny'
      | 'reauthorize'
      | 'logout'
      | 'register',
  ) => void;
}
const statusMessages: Partial<
  Record<
    AuthStatus,
    { tone: 'info' | 'warning' | 'danger' | 'success'; title: string; text: string }
  >
> = {
  'passkey-cancelled': {
    tone: 'warning',
    title: '通行密钥验证已取消',
    text: '身份验证尚未完成。可再次尝试，或选择密码验证。',
  },
  'password-error': {
    tone: 'danger',
    title: '密码验证未通过',
    text: '请重试或进入账号恢复。此页不收集真实密码。',
  },
  'email-waiting': {
    tone: 'info',
    title: '等待验证邮件',
    text: '请检查目标邮箱并按照邮件中的验证步骤继续。',
  },
  'email-failed': {
    tone: 'danger',
    title: '验证邮件未能发送',
    text: '原目标账号保持不变；可以重试发送。',
  },
  'recovery-complete': {
    tone: 'success',
    title: '恢复流程已完成',
    text: '请返回登录继续。',
  },
  'invite-expired': {
    tone: 'warning',
    title: '邀请已失效',
    text: '邀请不会加入家庭。请联系家庭成员获取新的邀请。',
  },
  'invite-accepted': {
    tone: 'success',
    title: '邀请已接受',
    text: '请重新读取家庭列表确认成员关系。',
  },
  allowed: {
    tone: 'success',
    title: '本次授权已允许',
    text: '权限限于下方列出的家庭和范围。',
  },
  denied: { tone: 'info', title: '已拒绝本次授权', text: '未建立连接，也未向服务提供家庭访问权。' },
  'reauthorization-required': {
    tone: 'warning',
    title: '等待宿主重新授权',
    text: '需要在宿主授权界面重新选择家庭与权限；旧写权限不会自动继承。',
  },
};
export function AccountSettingsPage(props: AccountSettingsPageProps) {
  const { identity, view, status, online, navigate, onAction } = props;
  const titles: Record<AuthView, string> = {
    account: '账号与安全',
    login: '登录松仓',
    oauth: '服务授权',
    host: '连接与授权',
    recovery: '恢复账号',
    invite: '家庭邀请',
  };
  const message = statusMessages[status];
  const security = props.credentialIntent;
  const securityTitle =
    security?.kind === 'rename-passkey'
      ? '重命名通行密钥'
      : security?.kind === 'remove-passkey'
        ? '移除这枚通行密钥？'
        : security?.kind === 'remove-password'
          ? '移除密码登录方式？'
          : '更新密码？';
  const removingLastMethod =
    security?.kind === 'remove-password'
      ? identity.passkeys.length === 0
      : security?.kind === 'remove-passkey'
        ? identity.passkeys.length === 1 && !identity.passwordConfigured
        : false;
  return (
    <SettingsLayout
      {...props}
      title={titles[view]}
      context={view === 'login' ? '松仓 · 继续访问你的家庭物品' : undefined}
      back={view === 'account' || view === 'host' ? '/settings' : '/settings/auth'}
    >
      {!online && (
        <InlineNotice tone="warning" title="当前离线，身份操作暂不可用">
          可以查看当前会话摘要。请恢复连接后验证身份或更改授权。
        </InlineNotice>
      )}
      {!props.secretFlowsAvailable && (
        <InlineNotice title="身份验证入口尚未接通">
          通行密钥登记、密码输入、邀请链接与授权交接需要相应的安全入口，当前不能执行。
        </InlineNotice>
      )}
      {!identity.fresh && view === 'account' && (
        <InlineNotice tone="warning" title="需要重新验证身份">
          请通过可用的登录入口重新验证，再修改登录方式。
        </InlineNotice>
      )}
      {message && (
        <InlineNotice tone={message.tone} title={message.title}>
          {message.text}
        </InlineNotice>
      )}
      {view === 'account' && (
        <>
          <SettingsSection title="当前账号">
            <SettingsFacts
              values={[
                { label: '显示名称', value: identity.name },
                { label: '邮箱', value: identity.email },
                { label: '会话状态', value: identity.signedIn ? '已登录' : '未登录' },
              ]}
            />
            {!identity.signedIn && (
              <Button onClick={() => navigate('/settings/auth?view=login')}>前往登录</Button>
            )}
          </SettingsSection>
          <SettingsSection title="通行密钥" description="修改登录方式前需要近期身份验证。">
            {identity.passkeys.length ? (
              identity.passkeys.map((key) => (
                <div className="vn-settings-row" key={key.id}>
                  <strong>{key.name}</strong>
                  <div className="vn-settings-actions">
                    <Button
                      variant="quiet"
                      disabled={!online || !identity.signedIn || !props.credentialsAvailable}
                      onClick={() =>
                        props.onCredentialIntent({ kind: 'rename-passkey', key: key.id })
                      }
                    >
                      重命名
                    </Button>
                    <Button
                      variant="quiet"
                      disabled={!online || !identity.signedIn || !props.credentialsAvailable}
                      onClick={() =>
                        props.onCredentialIntent({ kind: 'remove-passkey', key: key.id })
                      }
                    >
                      移除
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="vn-settings-muted">尚未登记通行密钥。</p>
            )}
            <Button
              variant="secondary"
              disabled={!online || !identity.signedIn || !props.secretFlowsAvailable}
              onClick={() => onAction('add-passkey')}
            >
              添加通行密钥
            </Button>
          </SettingsSection>
          <SettingsSection title="密码与恢复">
            <p className="vn-settings-muted">
              {identity.passwordConfigured ? '已设置密码' : '未设置密码'}
            </p>
            <div className="vn-settings-actions">
              <Button
                variant="secondary"
                disabled={!online || !identity.signedIn || !props.secretFlowsAvailable}
                onClick={() => props.onCredentialIntent({ kind: 'change-password' })}
              >
                {identity.passwordConfigured ? '修改密码' : '添加密码'}
              </Button>
              {identity.passwordConfigured && (
                <Button
                  variant="quiet"
                  disabled={!online || !identity.signedIn || !props.credentialsAvailable}
                  onClick={() => props.onCredentialIntent({ kind: 'remove-password' })}
                >
                  移除密码登录
                </Button>
              )}
            </div>
            <div className="vn-settings-link-list">
              <SettingsLink
                title="密码验证"
                detail="查看备用登录方式与错误恢复"
                onClick={() => navigate('/settings/auth?view=login&method=password')}
              />
              <SettingsLink
                title="恢复账号"
                detail="查看当前环境的账号恢复方式"
                onClick={() => navigate('/settings/auth?view=recovery')}
              />
            </div>
          </SettingsSection>
          <SettingsSection
            title="退出登录"
            description="退出会清理此设备的读缓存和会话；不会把草稿带到其他账号。"
          >
            <Button
              variant="danger"
              disabled={!identity.signedIn || !online}
              onClick={() => props.onLogoutOpen(true)}
            >
              退出当前账号
            </Button>
          </SettingsSection>
        </>
      )}
      {view === 'login' && (
        <>
          <SettingsSection title="验证你的身份" description="通过可用的身份验证入口继续。">
            <SettingsFacts
              values={[
                { label: '账号', value: identity.email },
                { label: '登录后返回', value: props.returnPath },
              ]}
            />
            <div className="vn-settings-stack">
              <Button
                disabled={!online || !props.secretFlowsAvailable}
                onClick={() => onAction('passkey')}
              >
                使用通行密钥登录
              </Button>
              <Button
                variant="secondary"
                disabled={!online || !props.secretFlowsAvailable}
                onClick={() => onAction('password')}
              >
                使用密码验证
              </Button>
            </div>
          </SettingsSection>
          <div className="vn-settings-actions">
            <Button variant="quiet" onClick={() => navigate('/settings/auth?view=recovery')}>
              无法登录，恢复账号
            </Button>
            {props.registrationAvailable ? (
              <Button variant="quiet" disabled={!online} onClick={() => onAction('register')}>
                注册账号
              </Button>
            ) : (
              <span className="vn-settings-muted">当前环境未开放注册。</span>
            )}
          </div>
        </>
      )}
      {view === 'recovery' && !props.recoveryAvailable && (
        <InlineNotice title="当前环境未开放邮箱找回">请使用已有密码或通行密钥登录。</InlineNotice>
      )}
      {view === 'recovery' && props.recoveryAvailable && (
        <>
          <SettingsSection
            title="通过邮箱恢复访问"
            description="恢复能力由当前环境提供；邮件链接需要单独验证。"
          >
            <SettingsFacts values={[{ label: '恢复邮箱', value: identity.email }]} />
            <Button
              disabled={!online}
              onClick={() =>
                onAction(status === 'email-failed' ? 'recovery-retry' : 'recovery-email')
              }
            >
              {status === 'email-waiting'
                ? '重新发送恢复邮件'
                : status === 'email-failed'
                  ? '重试发送恢复邮件'
                  : '发送恢复邮件'}
            </Button>
            {status === 'email-waiting' && <p>请在邮件链接中完成验证，再重新读取账号状态。</p>}
            <Button variant="quiet" onClick={() => navigate('/settings/auth?view=login')}>
              返回登录
            </Button>
          </SettingsSection>
        </>
      )}
      {view === 'invite' && (
        <SettingsSection title="加入家庭前核对">
          <SettingsFacts
            values={[
              { label: '邀请家庭', value: props.household.name },
              { label: '加入后权限', value: '与其他家庭成员相同' },
              {
                label: '状态',
                value:
                  status === 'invite-expired'
                    ? '已过期'
                    : status === 'invite-accepted'
                      ? '已接受'
                      : '等待接受',
              },
            ]}
          />
          {status !== 'invite-accepted' && (
            <Button
              disabled={!online || !props.secretFlowsAvailable || status === 'invite-expired'}
              onClick={() => onAction('accept-invite')}
            >
              接受邀请
            </Button>
          )}
          <Button variant="secondary" onClick={() => navigate('/settings/household')}>
            返回家庭列表
          </Button>
        </SettingsSection>
      )}
      {view === 'oauth' && (
        <>
          <SettingsSection
            title="允许此服务访问家庭？"
            description="授权前核对服务、目标家庭和每项权限。日常或管理模式不改变这些权限。"
          >
            <SettingsFacts
              values={[
                { label: '服务', value: props.connectionLabel },
                { label: '家庭', value: props.household.name },
                {
                  label: '请求权限',
                  value: (
                    <ul className="vn-settings-permissions">
                      <li>inventory:read · 查看物品、商品和位置</li>
                      {props.requestedWrite && (
                        <li>inventory:write · 修改家庭库存，具体操作仍需符合业务规则</li>
                      )}
                    </ul>
                  ),
                },
              ]}
            />
            {!['allowed', 'denied'].includes(status) && (
              <div className="vn-settings-actions">
                <Button
                  variant="secondary"
                  disabled={!online || !props.secretFlowsAvailable}
                  onClick={() => onAction('oauth-deny')}
                >
                  拒绝授权
                </Button>
                <Button
                  disabled={!online || !identity.signedIn || !props.secretFlowsAvailable}
                  onClick={() => onAction('oauth-allow')}
                >
                  允许上述权限
                </Button>
              </div>
            )}
            {!identity.signedIn && (
              <Button
                variant="secondary"
                onClick={() =>
                  navigate('/settings/auth?view=login&returnTo=%2Fsettings%2Fauth%3Fview%3Doauth')
                }
              >
                先登录再授权
              </Button>
            )}
          </SettingsSection>
          <Button variant="quiet" onClick={() => navigate('/settings/auth?view=host')}>
            查看连接状态
          </Button>
        </>
      )}
      {view === 'host' && (
        <>
          <SettingsSection title="当前宿主连接">
            <SettingsFacts
              values={[
                { label: '宿主', value: props.connectionLabel },
                { label: '连接家庭', value: props.household.name },
                {
                  label: '访问范围',
                  value: props.scopes.length ? props.scopes.join('、') : '尚未授权',
                },
                {
                  label: '宿主草稿存储',
                  value:
                    props.hostStorage === 'available'
                      ? '本会话可用；新对话或其他设备不保证恢复'
                      : '不可用；尚未发送的输入不会自动保存',
                },
                {
                  label: '连接状态',
                  value:
                    status === 'reauthorization-required'
                      ? '等待重新授权'
                      : props.scopes.length
                        ? '当前读取的连接有效'
                        : '未连接',
                },
              ]}
            />
          </SettingsSection>
          {props.hostStorage === 'unavailable' && (
            <InlineNotice tone="warning" title="宿主存储不可用">
              不能承诺草稿恢复；需要可靠保存原请求后才能发送写入。
            </InlineNotice>
          )}
          <SettingsSection
            title="授权范围"
            description="更改请求范围不会立即改变当前连接；须查看并明确同意新的授权。"
          >
            <Select
              label="下次请求的权限"
              value={props.requestedWrite ? 'write' : 'read'}
              onValueChange={(value) => props.onRequestedWrite(value === 'write')}
              options={[
                { value: 'read', label: '只读 · 查看库存' },
                { value: 'write', label: '读取与修改库存' },
              ]}
            />
            <div className="vn-settings-actions">
              <Button disabled={!online} onClick={() => navigate('/settings/auth?view=oauth')}>
                查看授权请求
              </Button>
              <Button
                variant="secondary"
                disabled={!online}
                onClick={() => onAction('reauthorize')}
              >
                重新授权当前连接
              </Button>
            </div>
          </SettingsSection>
          <InlineNotice
            title="账号与家庭在受控页面管理"
            action={
              <Button variant="secondary" onClick={() => navigate('/settings/household')}>
                查看家庭管理
              </Button>
            }
          >
            宿主连接不能直接切换家庭。新身份生效前，不使用旧授权发送新请求。
          </InlineNotice>
        </>
      )}
      <AlertDialog
        open={props.logoutOpen}
        onOpenChange={props.onLogoutOpen}
        title="退出当前账号？"
        description={
          props.allowPendingLogout
            ? '只退出隔离试用账号并清理读缓存，不影响真实账号。草稿与待确认请求留在原账号、原家庭，重新登录后可继续；提交中的任务会阻止退出。'
            : '只清理本次隔离预览的会话和读缓存，不影响真实账号。未决请求必须先核对；退出后不承诺跨账号恢复草稿。'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => props.onLogoutOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={(!props.allowPendingLogout && props.pendingCount > 0) || !online}
              onClick={() => onAction('logout')}
            >
              确认退出账号
            </Button>
          </>
        }
      >
        {props.pendingCount > 0 && (
          <InlineNotice
            tone="warning"
            title={`仍有 ${props.pendingCount} 项未完成任务`}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  props.onLogoutOpen(false);
                  navigate('/settings/cache');
                }}
              >
                查看并处理任务
              </Button>
            }
          >
            {props.allowPendingLogout
              ? '这些任务保留在原账号与原家庭，不会重新发送或在退出时删除。'
              : '先核对原请求；未发送草稿可在原家庭明确丢弃。'}
          </InlineNotice>
        )}
      </AlertDialog>
      <AlertDialog
        open={!!security}
        onOpenChange={(open) => {
          if (!open) props.onCredentialIntent(null);
        }}
        title={securityTitle}
        description="操作作用于当前账号。不会移除最后一种登录方式。"
        footer={
          <>
            <Button variant="secondary" onClick={() => props.onCredentialIntent(null)}>
              取消
            </Button>
            <Button
              variant={
                security?.kind === 'remove-passkey' || security?.kind === 'remove-password'
                  ? 'danger'
                  : 'primary'
              }
              disabled={
                !online ||
                !identity.signedIn ||
                !props.credentialsAvailable ||
                security?.kind === 'change-password' ||
                removingLastMethod ||
                (security?.kind === 'rename-passkey' && !props.credentialName.trim())
              }
              onClick={props.onConfirmCredential}
            >
              确认更新设置
            </Button>
          </>
        }
      >
        {security?.kind === 'rename-passkey' && (
          <FormField
            label="通行密钥名称"
            required
            hint="仅编辑便于识别的设备名称，不涉及密钥内容。"
            hintMode="visible"
          >
            <Input
              value={props.credentialName}
              maxLength={80}
              onChange={(event) => props.onCredentialName(event.target.value)}
            />
          </FormField>
        )}
        {security?.kind === 'change-password' && <p>当前页面尚未提供密码输入与验证流程。</p>}
        {security?.kind === 'remove-passkey' && (
          <p>
            将移除：
            {identity.passkeys.find((key) => key.id === security.key)?.name || '这枚通行密钥'}
          </p>
        )}
        {removingLastMethod && (
          <InlineNotice tone="warning" title="不能移除最后一种登录方式">
            请先添加另一枚通行密钥或设置密码，再移除当前方式。
          </InlineNotice>
        )}
      </AlertDialog>
    </SettingsLayout>
  );
}
