import { Button } from '../../../ui/components/ui/button';
import { FormField } from '../../../ui/components/ui/form-field';
import { Input } from '../../../ui/components/ui/input';
import { Select } from '../../../ui/components/ui/select';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import {
  SettingsFacts,
  SettingsLayout,
  SettingsReadBoundary,
  SettingsSection,
} from './settings-layout';
import type { InspectorRecord, SettingsPageProps, SettingsReadState } from './models';
export interface SettingsInspectorProps extends SettingsPageProps {
  records: readonly InspectorRecord[];
  scope: 'items' | 'catalog' | 'session';
  query: string;
  readState: SettingsReadState;
  online: boolean;
  selectedId: string | null;
  onScope: (scope: 'items' | 'catalog' | 'session') => void;
  onQuery: (query: string) => void;
  onSelect: (id: string | null) => void;
  onRetry: () => void;
}
export function SettingsInspector(props: SettingsInspectorProps) {
  const { scope, query, records, selectedId } = props;
  const matches = records.filter(
    (record) =>
      record.scope === scope &&
      `${record.id} ${record.title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const selected = matches.find((record) => record.id === selectedId);
  return (
    <SettingsLayout {...props} title="只读检查器">
      <InlineNotice title="高级诊断 · 仅查看">
        会话令牌、邮箱和宿主存储内容已脱敏。此页不提供
        SQL、任意查询或记录写入；修改请回到对应业务任务。
      </InlineNotice>
      <SettingsFacts
        values={[
          {
            label: '读取范围',
            value: `${props.household.name} · ${props.online ? '隔离样例快照' : '已缓存的样例快照'}`,
          },
          { label: '协议', value: 'read-v2' },
          { label: '脱敏策略', value: '只展示预设安全字段，敏感值替换为 [REDACTED]' },
        ]}
      />
      <SettingsSection title="记录查询">
        <div className="vn-settings-fields">
          <Select
            label="记录类型"
            value={scope}
            options={[
              { value: 'items', label: '物品' },
              { value: 'catalog', label: '商品资料' },
              { value: 'session', label: '会话与缓存' },
            ]}
            onValueChange={(value) => props.onScope(value as SettingsInspectorProps['scope'])}
          />
          <FormField label="按名称或记录标识筛选">
            <Input
              value={query}
              onChange={(event) => props.onQuery(event.target.value)}
              placeholder="仅筛选当前范围"
              type="search"
            />
          </FormField>
        </div>
        <SettingsReadBoundary state={props.readState} onRetry={props.onRetry}>
          <p className="vn-settings-muted">当前范围 {matches.length} 条 · 不代表服务端总数</p>
          {matches.length === 0 ? (
            <InlineNotice
              title="当前筛选没有匹配记录"
              action={
                query ? (
                  <Button variant="secondary" onClick={() => props.onQuery('')}>
                    清除筛选
                  </Button>
                ) : undefined
              }
            >
              仅对已读取的此类记录筛选，没有扩大查询范围。
            </InlineNotice>
          ) : (
            matches.map((record) => (
              <article className="vn-settings-row" key={record.id}>
                <div>
                  <strong>{record.title}</strong>
                  <p className="vn-settings-reference">{record.id}</p>
                </div>
                <Button
                  variant="secondary"
                  aria-expanded={selectedId === record.id}
                  onClick={() => props.onSelect(selectedId === record.id ? null : record.id)}
                >
                  {selectedId === record.id ? '收起原始字段' : '查看原始字段'}
                </Button>
              </article>
            ))
          )}
          {selected && (
            <div className="vn-settings-stack">
              <h3>{selected.title} · 原始字段</h3>
              <pre
                className="vn-settings-json"
                tabIndex={0}
                aria-label={`${selected.title}的脱敏原始字段`}
              >
                {JSON.stringify(selected.fields, null, 2)}
              </pre>
              <p className="vn-settings-muted">
                字段原名保留；缺失字段不补成 false、0 或空字符串。
              </p>
            </div>
          )}
        </SettingsReadBoundary>
      </SettingsSection>
      <Button variant="secondary" onClick={() => props.navigate('/settings/cache')}>
        查看缓存与恢复任务
      </Button>
    </SettingsLayout>
  );
}
