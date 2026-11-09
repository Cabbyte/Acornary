import { Button } from '../../../ui/components/ui/button';
import { RadioGroup } from '../../../ui/components/ui/radio-group';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import { AlertDialog } from '../../../ui/components/ui/alert-dialog';
import { SettingsLayout, SettingsReadBoundary, SettingsSection } from './settings-layout';
import {
  roleLabels,
  type SettingsHousehold,
  type SettingsPageProps,
  type SettingsReadState,
  type SettingsTask,
} from './models';
export interface HouseholdSettingsPageProps extends SettingsPageProps {
  households: readonly SettingsHousehold[];
  tasks: readonly SettingsTask[];
  readState: SettingsReadState;
  online: boolean;
  host: boolean;
  selectedId: string | null;
  draftChoice: 'keep' | 'discard';
  onSelect: (id: string | null) => void;
  onDraftChoice: (choice: 'keep' | 'discard') => void;
  onConfirmSwitch: () => void;
  onReconcile: (id: string) => void;
  onRetry: () => void;
}
export function HouseholdSettingsPage(props: HouseholdSettingsPageProps) {
  const {
    household,
    households,
    tasks,
    selectedId,
    onSelect,
    draftChoice,
    onDraftChoice,
    onConfirmSwitch,
    onReconcile,
    online,
    host,
    navigate,
  } = props;
  const target = households.find((entry) => entry.id === selectedId);
  const scopedTasks = tasks.filter(
    (task) => task.householdId === household.id && task.state !== 'confirmed',
  );
  const unknown = scopedTasks.filter((task) => task.state === 'unknown');
  const drafts = scopedTasks.filter((task) => task.state === 'draft');
  return (
    <SettingsLayout {...props} title="家庭">
      <p className="vn-settings-muted">日常与管理使用同一家庭；切换模式不会增加权限。</p>
      <SettingsReadBoundary state={props.readState} onRetry={props.onRetry}>
        <SettingsSection title="可访问的家庭">
          {households.length === 0 ? (
            <InlineNotice title="目前没有可访问的家庭">请在账号与安全中查看邀请状态。</InlineNotice>
          ) : (
            households.map((entry) => (
              <article className="vn-settings-row" key={entry.id}>
                <div>
                  <h3>{entry.name}</h3>
                  <p className="vn-settings-muted">
                    {roleLabels[entry.role]} · {entry.memberCount} 位成员
                    {entry.id === household.id ? ' · 当前家庭' : ''}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={entry.id === household.id || !online || host}
                  onClick={() => onSelect(entry.id)}
                >
                  {entry.id === household.id ? '正在使用' : '切换到此家庭'}
                </Button>
              </article>
            ))
          )}
        </SettingsSection>
      </SettingsReadBoundary>
      {!online && (
        <InlineNotice tone="warning" title="离线时不能切换家庭">
          当前缓存仍属于 {household.name}，恢复连接后重新获取身份和权限。
        </InlineNotice>
      )}
      {host && (
        <InlineNotice
          title="在宿主授权界面选择家庭"
          action={
            <Button variant="secondary" onClick={() => navigate('/settings/auth?view=host')}>
              查看当前连接
            </Button>
          }
        >
          当前连接不能直接切换家庭。重新授权后需重新获取会话与权限，不沿用旧连接的写权限。
        </InlineNotice>
      )}
      <Button variant="secondary" onClick={() => navigate('/settings/members')}>
        查看当前家庭成员
      </Button>
      <AlertDialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open) onSelect(null);
        }}
        title={`切换到 ${target?.name || '另一家庭'}？`}
        description={`当前家庭：${household.name}。切换将清除当前选择与读缓存，重新获取目标家庭会话；保留的草稿只属于原家庭。`}
        footer={
          <>
            <Button variant="secondary" onClick={() => onSelect(null)}>
              取消
            </Button>
            <Button disabled={unknown.length > 0 || !online || host} onClick={onConfirmSwitch}>
              确认切换家庭
            </Button>
          </>
        }
      >
        <div className="vn-settings-stack">
          {unknown.length > 0 && (
            <InlineNotice tone="warning" title="先核对结果待确认的原请求">
              不能通过丢弃草稿掩盖可能已经发生的写入。
            </InlineNotice>
          )}
          {unknown.map((task) => (
            <article className="vn-settings-row" key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <p className="vn-settings-muted">诊断引用：{task.id}</p>
              </div>
              <Button variant="secondary" onClick={() => onReconcile(task.id)}>
                核对原请求
              </Button>
            </article>
          ))}
          {drafts.length > 0 && (
            <RadioGroup
              label={`${drafts.length} 项尚未发送的草稿`}
              value={draftChoice}
              onValueChange={(value) => onDraftChoice(value as 'keep' | 'discard')}
              orientation="vertical"
              showOptionDescriptions
              options={[
                {
                  value: 'keep',
                  label: '保留在原家庭',
                  description: `以后返回 ${household.name} 时再继续`,
                },
                {
                  value: 'discard',
                  label: '丢弃这些未发送草稿',
                  description: '仅移除此预览中的草稿，不包括已发送请求',
                },
              ]}
            />
          )}
          {scopedTasks.length === 0 && <p>当前家庭没有未发送草稿或待确认请求。</p>}
        </div>
      </AlertDialog>
    </SettingsLayout>
  );
}
