import { Button } from '../../../ui/components/ui/button';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import { AlertDialog } from '../../../ui/components/ui/alert-dialog';
import { SettingsLayout, SettingsReadBoundary, SettingsSection } from './settings-layout';
import type {
  SettingsInvitation,
  SettingsMember,
  SettingsPageProps,
  SettingsReadState,
} from './models';
export type MemberIntent = { kind: 'leave'; memberId: string } | null;
export interface MemberSettingsPageProps extends SettingsPageProps {
  members: readonly SettingsMember[];
  invitations: readonly SettingsInvitation[];
  readState: SettingsReadState;
  online: boolean;
  canManage: boolean;
  intent: MemberIntent;
  onInvite: () => void;
  onRevoke: (id: string) => void;
  onIntent: (intent: MemberIntent) => void;
  onConfirmIntent: () => void;
  onRetry: () => void;
  pendingCount: number;
  leaveUnavailableReason?: string;
  inviteUnavailableReason?: string;
}
export function MemberSettingsPage(props: MemberSettingsPageProps) {
  const { members, invitations, canManage, online, intent, onIntent, pendingCount } = props;
  const target = intent && members.find((member) => member.id === intent.memberId && member.self);
  const leaveReason =
    members.length < 2 ? '最后一名成员不能退出家庭。' : props.leaveUnavailableReason;
  return (
    <SettingsLayout {...props} title="成员与邀请" back="/settings/household">
      {!canManage && (
        <InlineNotice title="当前连接不能修改家庭设置">
          请使用有效的网页账号会话查看可用操作；连接的库存读取权限不代表账号管理权限。
        </InlineNotice>
      )}
      {!online && (
        <InlineNotice tone="warning" title="当前离线">
          成员信息来自缓存，修改需要联网。
        </InlineNotice>
      )}
      <SettingsReadBoundary state={props.readState} onRetry={props.onRetry}>
        <SettingsSection title="家庭成员" description="家庭成员权限相同，可以查看和管理家庭库存。">
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
                    <p className="vn-settings-muted">{member.email}</p>
                  </div>
                </div>
                {member.self && (
                  <>
                    <Button
                      variant="quiet"
                      disabled={!online || !canManage || !!leaveReason || pendingCount > 0}
                      onClick={() => onIntent({ kind: 'leave', memberId: member.id })}
                    >
                      离开此家庭
                    </Button>
                    {leaveReason && <p className="vn-settings-muted">{leaveReason}</p>}
                  </>
                )}
              </article>
            ))
          )}
        </SettingsSection>
        <SettingsSection
          title="邀请"
          description="邀请链接 7 天有效、单次使用。接受后成为权限相同的家庭成员。"
        >
          <div className="vn-settings-member-actions">
            <Button
              disabled={!online || !canManage || !!props.inviteUnavailableReason}
              onClick={props.onInvite}
            >
              创建邀请链接
            </Button>
          </div>
          {props.inviteUnavailableReason && (
            <p className="vn-settings-muted">{props.inviteUnavailableReason}</p>
          )}
          {invitations.length === 0 ? (
            <p className="vn-settings-muted">当前没有邀请。</p>
          ) : (
            invitations.map((invitation) => (
              <article className="vn-settings-row" key={invitation.id}>
                <div>
                  <strong>{invitation.label}</strong>
                  <p className="vn-settings-muted">
                    {
                      { pending: '等待接受', revoked: '已撤销', expired: '已过期', used: '已使用' }[
                        invitation.state
                      ]
                    }
                  </p>
                </div>
                {invitation.state === 'pending' && (
                  <Button
                    variant="secondary"
                    disabled={!online || !canManage}
                    onClick={() => props.onRevoke(invitation.id)}
                  >
                    撤销邀请
                  </Button>
                )}
              </article>
            ))
          )}
        </SettingsSection>
      </SettingsReadBoundary>
      <AlertDialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open) onIntent(null);
        }}
        title={`离开 ${props.household.name}？`}
        description="离开后不能再访问此家庭。先核对待确认请求，未发送草稿不会转移到其他家庭。"
        footer={
          <>
            <Button variant="secondary" onClick={() => onIntent(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={!online || !canManage || !!leaveReason || pendingCount > 0}
              onClick={props.onConfirmIntent}
            >
              确认离开家庭
            </Button>
          </>
        }
      >
        {pendingCount > 0 && (
          <InlineNotice tone="warning" title="先处理未完成任务">
            当前仍有 {pendingCount} 项草稿或待确认请求，暂不能离开。
          </InlineNotice>
        )}
      </AlertDialog>
    </SettingsLayout>
  );
}
