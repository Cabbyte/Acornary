import { Button } from '../../../ui/components/ui/button';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import { AlertDialog } from '../../../ui/components/ui/alert-dialog';
import {
  SettingsFacts,
  SettingsLayout,
  SettingsReadBoundary,
  SettingsSection,
} from './settings-layout';
import type { CacheSnapshot, SettingsPageProps, SettingsReadState, SettingsTask } from './models';
export interface CacheSettingsPageProps extends SettingsPageProps {
  online: boolean;
  cache: CacheSnapshot;
  tasks: readonly SettingsTask[];
  readState: SettingsReadState;
  clearOpen: boolean;
  discardTask: SettingsTask | null;
  onRetry: () => void;
  onRefresh: () => void;
  onClearOpen: (open: boolean) => void;
  onClear: () => void;
  onReconcile: (id: string) => void;
  onDiscardIntent: (task: SettingsTask | null) => void;
  onDiscard: () => void;
}
export function CacheSettingsPage(props: CacheSettingsPageProps) {
  const { online, cache, tasks } = props;
  const scoped = tasks.filter((task) => task.householdId === props.household.id);
  return (
    <SettingsLayout {...props} title="缓存与连接">
      <InlineNotice
        tone={online ? 'info' : 'warning'}
        title={online ? '在线 · 当前为隔离预览' : '当前离线 · 仅可查看已有缓存'}
      >
        {online
          ? '更新仅读取预设示例；不会请求正式库存。'
          : '缓存可能不完整，不能用于判断家庭总量。写入和身份切换需要恢复连接。'}
      </InlineNotice>
      <SettingsSection
        title="读缓存"
        description="缓存与当前账号、家庭绑定；不替代云端库存。统计与库存页面独立读取。"
      >
        <SettingsReadBoundary state={props.readState} onRetry={props.onRetry}>
          {cache.state === 'empty' ? (
            <InlineNotice title="此家庭尚无本地读缓存">
              当前没有可离线查看的数据；这不代表家庭里没有物品。
            </InlineNotice>
          ) : (
            <SettingsFacts
              values={[
                { label: '上次更新', value: cache.updatedAt },
                { label: '物品范围', value: `${cache.itemCount} 件已打开的示例实物，非全家总数` },
                { label: '商品范围', value: `${cache.catalogCount} 条已读取的示例商品资料` },
                {
                  label: '历史范围',
                  value: `最近已打开的 ${cache.historyCount} 条记录，未缓存更早历史`,
                },
                { label: '未缓存内容', value: '附件原文件、未打开的记录和完整历史' },
              ]}
            />
          )}
          <div className="vn-settings-actions">
            <Button variant="secondary" disabled={!online} onClick={props.onRefresh}>
              更新示例缓存
            </Button>
            <Button
              variant="danger"
              disabled={cache.state === 'empty'}
              onClick={() => props.onClearOpen(true)}
            >
              清理读缓存
            </Button>
          </div>
        </SettingsReadBoundary>
      </SettingsSection>
      <SettingsSection
        title="草稿与待恢复请求"
        description="与读缓存分开保存。清理读缓存不会移除待确认请求，也不会把它们标记为失败。"
      >
        {scoped.length === 0 ? (
          <p className="vn-settings-muted">当前家庭没有草稿或待恢复请求。</p>
        ) : (
          scoped.map((task) => (
            <article className="vn-settings-row" key={task.id}>
              <div>
                <h3>{task.title}</h3>
                <p className="vn-settings-muted">
                  {
                    {
                      draft: '尚未发送 · 可恢复草稿',
                      unknown: '结果待确认 · 须核对原请求',
                      confirmed: '已核对 · 原请求已完成',
                    }[task.state]
                  }
                </p>
                <p className="vn-settings-reference">诊断引用：{task.id}</p>
              </div>
              {task.state === 'unknown' && (
                <Button
                  variant="secondary"
                  disabled={!online}
                  onClick={() => props.onReconcile(task.id)}
                >
                  核对原请求
                </Button>
              )}
              {task.state === 'draft' && (
                <Button variant="quiet" onClick={() => props.onDiscardIntent(task)}>
                  丢弃此草稿
                </Button>
              )}
            </article>
          ))
        )}
        {scoped.some((task) => task.state === 'unknown') && (
          <InlineNotice tone="warning" title="身份变化前先核对原请求">
            若仍无法确认，停止依赖此次结果的写入，并保留诊断引用。不会创建新的重试请求。
          </InlineNotice>
        )}
      </SettingsSection>
      <SettingsSection title="连接诊断">
        <Button variant="secondary" onClick={() => props.navigate('/settings/inspector')}>
          打开只读检查器
        </Button>
      </SettingsSection>
      <AlertDialog
        open={props.clearOpen}
        onOpenChange={props.onClearOpen}
        title="清理本次预览的读缓存？"
        description={`只清理 ${props.household.name} 的示例读取快照。保留全部未发送草稿、原请求与待确认结果；不会清理浏览器中其他页面、账号或正式数据。`}
        footer={
          <>
            <Button variant="secondary" onClick={() => props.onClearOpen(false)}>
              取消
            </Button>
            <Button variant="danger" onClick={props.onClear}>
              确认清理示例读缓存
            </Button>
          </>
        }
      />
      <AlertDialog
        open={!!props.discardTask}
        onOpenChange={(open) => {
          if (!open) props.onDiscardIntent(null);
        }}
        title="丢弃这项未发送草稿？"
        description={`${props.discardTask?.title || ''}。仅移除当前家庭的这份预览草稿。已发送请求和结果待确认任务不受影响。`}
        footer={
          <>
            <Button variant="secondary" onClick={() => props.onDiscardIntent(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={props.onDiscard}>
              确认丢弃草稿
            </Button>
          </>
        }
      />
    </SettingsLayout>
  );
}
