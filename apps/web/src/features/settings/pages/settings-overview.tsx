import { Database, Home, KeyRound, Printer, ScanSearch, Users } from 'lucide-react';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import { SettingsFacts, SettingsLayout, SettingsLink, SettingsSection } from './settings-layout';
import { roleLabels, type SettingsIdentity, type SettingsPageProps } from './models';
export interface SettingsOverviewProps extends SettingsPageProps {
  identity: SettingsIdentity;
  online: boolean;
  taskCount: number;
  cacheLabel: string;
  host: boolean;
}
export function SettingsOverview(props: SettingsOverviewProps) {
  const { identity, household, navigate, online, taskCount, cacheLabel, host } = props;
  return (
    <SettingsLayout {...props} title="设置" back={null}>
      <SettingsSection title={identity.signedIn ? identity.name : '尚未登录'}>
        <SettingsFacts
          values={[
            {
              label: '账号',
              value: identity.signedIn ? identity.email : '可使用通行密钥或密码登录',
            },
            { label: '当前家庭', value: household.name },
            { label: '角色', value: roleLabels[household.role] },
          ]}
        />
      </SettingsSection>
      {!online && (
        <InlineNotice tone="warning" title="当前离线，只能查看已缓存的范围">
          账号与连接入口仍可打开，修改需恢复连接。
        </InlineNotice>
      )}
      {taskCount > 0 && (
        <InlineNotice
          tone="warning"
          title={`有 ${taskCount} 项草稿或待确认任务`}
          action={
            <SettingsLink
              title="查看恢复状态"
              detail="切换家庭或退出前先核对"
              onClick={() => navigate('/settings/cache')}
            />
          }
        >
          未决请求不会随清理读缓存一起删除。
        </InlineNotice>
      )}
      <SettingsSection title="账号与家庭">
        <div className="vn-settings-link-list">
          <SettingsLink
            title="账号与安全"
            detail={identity.signedIn ? '通行密钥、密码、恢复与退出' : '登录与恢复账号'}
            icon={<KeyRound size={20} />}
            onClick={() => navigate(`/settings/auth${identity.signedIn ? '' : '?view=login'}`)}
          />
          <SettingsLink
            title="家庭"
            detail={`${household.name} · ${roleLabels[household.role]}`}
            icon={<Home size={20} />}
            onClick={() => navigate('/settings/household')}
          />
          <SettingsLink
            title="成员与邀请"
            detail={`${household.memberCount} 位成员 · 按角色管理权限`}
            icon={<Users size={20} />}
            onClick={() => navigate('/settings/members')}
          />
          <SettingsLink
            title="连接与授权"
            detail={host ? '当前宿主连接、家庭与访问范围' : '服务授权和宿主连接状态'}
            icon={<KeyRound size={20} />}
            onClick={() => navigate('/settings/auth?view=host')}
          />
        </div>
      </SettingsSection>
      <SettingsSection title="此设备">
        <div className="vn-settings-link-list">
          <SettingsLink
            title="打印机与标签"
            detail="D101、标签纸与试打"
            icon={<Printer size={20} />}
            onClick={() => navigate('/settings/printing')}
          />
          <SettingsLink
            title="缓存与连接"
            detail={`${online ? '在线' : '离线'} · ${cacheLabel}`}
            icon={<Database size={20} />}
            onClick={() => navigate('/settings/cache')}
          />
        </div>
      </SettingsSection>
      <SettingsSection title="高级">
        <SettingsLink
          title="只读检查器"
          detail="查看原始字段、协议版本与脱敏诊断"
          icon={<ScanSearch size={20} />}
          onClick={() => navigate('/settings/inspector')}
        />
      </SettingsSection>
    </SettingsLayout>
  );
}
