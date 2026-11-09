import { Button } from '../../../ui/components/ui/button';
import { Select } from '../../../ui/components/ui/select';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import { AlertDialog } from '../../../ui/components/ui/alert-dialog';
import { SettingsLayout, SettingsReadBoundary, SettingsSection } from './settings-layout';
import {
  roleLabels,
  type MemberRole,
  type SettingsInvitation,
  type SettingsMember,
  type SettingsPageProps,
  type SettingsReadState,
} from './models';
export type MemberIntent =
  | { kind: 'role'; memberId: string; role: 'admin' | 'member' | 'viewer' }
  | { kind: 'remove'; memberId: string }
  | { kind: 'leave'; memberId: string }
  | null;
export interface MemberSettingsPageProps extends SettingsPageProps {
  members: readonly SettingsMember[];
  invitations: readonly SettingsInvitation[];
  readState: SettingsReadState;
  online: boolean;
  canManage: boolean;
  inviteRole: 'member' | 'viewer';
  intent: MemberIntent;
  onInviteRole: (role: 'member' | 'viewer') => void;
  onInvite: () => void;
  onRevoke: (id: string) => void;
  onIntent: (intent: MemberIntent) => void;
  onConfirmIntent: () => void;
  onRetry: () => void;
  pendingCount: number;
}
export function MemberSettingsPage(props: MemberSettingsPageProps) {
  const { members, invitations, canManage, online, intent, onIntent, pendingCount } = props;
  const target = intent && members.find((member) => member.id === intent.memberId);
  const roleOptions = [
    { value: 'admin', label: '管理员' },
    { value: 'member', label: '成员' },
    { value: 'viewer', label: '只读成员' },
  ];
  const action =
    intent?.kind === 'role'
      ? `将 ${target?.name} 的角色改为${roleLabels[intent.role]}`
      : intent?.kind === 'leave'
        ? `离开 ${props.household.name}`
        : `移除成员 ${target?.name}`;
  return (
    <SettingsLayout {...props} title="成员与邀请" back="/settings/household">
      {!canManage && (
        <InlineNotice title="当前角色不能管理其他成员">
          可以查看获授权的成员信息。角色更改、邀请与移除仅对有管理权限的账号开放。
        </InlineNotice>
      )}
      {!online && (
        <InlineNotice tone="warning" title="当前离线">
          成员信息来自缓存，修改需要联网。
        </InlineNotice>
      )}
      <SettingsReadBoundary state={props.readState} onRetry={props.onRetry}>
        <SettingsSection
          title="家庭成员"
          description="所有者管理家庭；管理员管理成员和库存；成员可使用库存；只读成员仅查看。"
        >
          {members.length === 0 ? (
            <p className="vn-settings-muted">当前范围没有可显示的成员。</p>
          ) : (
            members.map((member) => (
              <article className="vn-settings-member" key={member.id}>
                <div className="vn-settings-row">
                  <div>
                    <h3>
                      {member.name}
                      {member.self ? '（你）' : ''}
                    </h3>
                    <p className="vn-settings-muted">
                      {member.email} · {roleLabels[member.role]}
                    </p>
                  </div>
                  {member.role === 'owner' && <span className="vn-settings-pill">所有者</span>}
                </div>
                {canManage && !member.self && member.role !== 'owner' && (
                  <div className="vn-settings-member-actions">
                    <Select
                      label={`${member.name}的角色`}
                      value={member.role}
                      options={roleOptions}
                      disabled={!online}
                      onValueChange={(role) => {
                        if (role && role !== member.role)
                          onIntent({
                            kind: 'role',
                            memberId: member.id,
                            role: role as 'admin' | 'member' | 'viewer',
                          });
                      }}
                    />
                    <Button
                      variant="quiet"
                      disabled={!online}
                      onClick={() => onIntent({ kind: 'remove', memberId: member.id })}
                    >
                      移除成员
                    </Button>
                  </div>
                )}
                {member.self && member.role !== 'owner' && (
                  <Button
                    variant="quiet"
                    disabled={!online}
                    onClick={() => onIntent({ kind: 'leave', memberId: member.id })}
                  >
                    离开此家庭
                  </Button>
                )}
                {member.self && member.role === 'owner' && (
                  <p className="vn-settings-muted">
                    所有者不能直接离开；当前环境尚未开放所有权转移。
                  </p>
                )}
              </article>
            ))
          )}
        </SettingsSection>
        <SettingsSection
          title="邀请"
          description="邀请在接受前不会成为家庭成员；以下操作仅生成隔离预览记录，不发送邮件。"
        >
          {canManage && (
            <div className="vn-settings-member-actions">
              <Select
                label="邀请角色"
                value={props.inviteRole}
                options={[
                  { value: 'member', label: '成员 · 可使用库存' },
                  { value: 'viewer', label: '只读成员 · 仅查看' },
                ]}
                disabled={!online}
                onValueChange={(role) => props.onInviteRole(role as 'member' | 'viewer')}
              />
              <Button disabled={!online} onClick={props.onInvite}>
                生成邀请样例
              </Button>
            </div>
          )}
          {invitations.length === 0 ? (
            <p className="vn-settings-muted">当前没有邀请。</p>
          ) : (
            invitations.map((invitation) => (
              <article className="vn-settings-row" key={invitation.id}>
                <div>
                  <strong>{invitation.label}</strong>
                  <p className="vn-settings-muted">
                    {roleLabels[invitation.role]} ·{' '}
                    {
                      { pending: '等待接受', revoked: '已撤销', expired: '已过期' }[
                        invitation.state
                      ]
                    }
                  </p>
                </div>
                {canManage && invitation.state === 'pending' && (
                  <Button
                    variant="secondary"
                    disabled={!online}
                    onClick={() => props.onRevoke(invitation.id)}
                  >
                    撤销邀请
                  </Button>
                )}
                {invitation.state === 'expired' && (
                  <Button
                    variant="quiet"
                    onClick={() => props.navigate('/settings/auth?view=invite&state=expired')}
                  >
                    查看邀请状态
                  </Button>
                )}
              </article>
            ))
          )}
        </SettingsSection>
      </SettingsReadBoundary>
      <AlertDialog
        open={!!intent && !!target}
        onOpenChange={(open) => {
          if (!open) onIntent(null);
        }}
        title={`${action}？`}
        description={
          intent?.kind === 'role'
            ? '权限变更仅作用于当前家庭。确认后，该成员须按新角色重新获取能力。'
            : intent?.kind === 'leave'
              ? '离开后不能再访问此家庭。先核对待确认请求，未发送草稿不会转移到其他家庭。'
              : '移除后，该成员将失去此家庭的访问权；已有物品与历史不会删除。'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => onIntent(null)}>
              取消
            </Button>
            <Button
              variant={intent?.kind === 'role' ? 'primary' : 'danger'}
              disabled={!online || (intent?.kind === 'leave' && pendingCount > 0)}
              onClick={props.onConfirmIntent}
            >
              {intent?.kind === 'role'
                ? '确认更改角色'
                : intent?.kind === 'leave'
                  ? '确认离开家庭'
                  : '确认移除成员'}
            </Button>
          </>
        }
      >
        {intent?.kind === 'leave' && pendingCount > 0 && (
          <InlineNotice
            tone="warning"
            title="先处理未完成任务"
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  onIntent(null);
                  props.navigate('/settings/cache');
                }}
              >
                查看待恢复任务
              </Button>
            }
          >
            当前仍有 {pendingCount} 项草稿或待确认请求，暂不能离开。
          </InlineNotice>
        )}
      </AlertDialog>
    </SettingsLayout>
  );
}
