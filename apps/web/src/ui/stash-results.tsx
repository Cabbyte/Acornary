import { Button, Checkbox, Pagination, Typography } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import {
  isTerminal,
  itemName,
  type InventoryData,
  type ItemRecord,
} from '../../../../packages/contracts/src/web';
import { fullPath, specification } from '../lib/browse';
import { itemFacts, latestNote } from '../lib/workbench';
import { itemAttention, stashDate, type StashGroup } from '../lib/stash';
export function StashResults({
  groups,
  allGroups,
  productMode,
  data,
  expanded,
  collapsed,
  pages,
  forceExpand,
  selected,
  inspect,
  toggle,
  changeExpanded,
  changePage,
  selectGroup,
  query,
}: {
  groups: StashGroup[];
  allGroups: StashGroup[];
  productMode: boolean;
  data: InventoryData;
  expanded: string[];
  collapsed: string[];
  pages: Record<string, number>;
  forceExpand: boolean;
  selected: string[];
  inspect: (item: ItemRecord) => void;
  toggle: (item: ItemRecord) => void;
  changeExpanded: (id: string) => void;
  changePage: (id: string, page: number) => void;
  selectGroup: (items: ItemRecord[]) => void;
  query: string;
}) {
  return (
    <div className="stash-results" aria-label="物品分组">
      {groups.map((group) => {
        const opened =
          group.items.length === 1 ||
          (forceExpand ? !collapsed.includes(group.id) : expanded.includes(group.id));
        const page = productMode
          ? Math.min(pages[group.id] ?? 1, Math.ceil(group.items.length / 20))
          : 1;
        const shown = productMode ? group.items.slice((page - 1) * 20, page * 20) : group.items;
        const all = allGroups.find((g) => g.id === group.id)?.items ?? group.items;
        const attention = group.items.filter((item) => itemAttention(item, data).length).length;
        return (
          <section className="stash-group" key={group.id}>
            <div className="stash-group-heading">
              <Button
                type="text"
                className="stash-group-toggle"
                aria-expanded={opened}
                onClick={() =>
                  group.items.length === 1 ? inspect(group.items[0]) : changeExpanded(group.id)
                }
              >
                {group.items.length > 1 && (opened ? <DownOutlined /> : <RightOutlined />)}
                <span>
                  <strong>{group.title}</strong>
                  <small>
                    {group.items.length}
                    {!productMode && all.length > group.items.length ? ` / ${all.length}` : ''} 件 ·{' '}
                    {new Set(all.map((i) => i.parent_id).filter(Boolean)).size} 个已知位置
                    {all.some((i) => !i.parent_id) && ' · 含未指定位置'}
                    {attention > 0 && ` · ${attention} 件需留意`}
                  </small>
                </span>
              </Button>
              {opened && group.items.length > 1 && (
                <Button
                  type="text"
                  size="small"
                  onClick={() => selectGroup(all.filter((i) => !isTerminal(i)))}
                >
                  选择本组匹配的 {all.filter((i) => !isTerminal(i)).length} 件
                </Button>
              )}
            </div>
            {opened && (
              <div className="stash-instances">
                {shown.map((item) => {
                  const date = stashDate(item, data);
                  const note = latestNote(data, item.id);
                  const sku = data.catalog.find((c) => c.id === item.catalog_node_id);
                  const facts = itemFacts(item)
                    .split(' · ')
                    .filter((f) => !f.startsWith('到期 '))
                    .join(' · ');
                  return (
                    <div
                      className={`stash-instance${selected.includes(item.id) ? ' is-selected' : ''}`}
                      key={item.id}
                    >
                      <Checkbox
                        aria-label={`选择 ${itemName(item, data)} ${item.id}`}
                        disabled={isTerminal(item)}
                        checked={selected.includes(item.id)}
                        onChange={() => toggle(item)}
                      />
                      <Button
                        type="text"
                        className="stash-item-open"
                        aria-label={`${itemName(item, data)}，尾号 ${item.id.slice(-8)}，${fullPath(item.parent_id, data)}`}
                        data-inspect-id={item.id}
                        onClick={() => inspect(item)}
                      >
                        <span className="stash-item-copy">
                          <strong>{itemName(item, data)}</strong>
                          <span className="stash-item-location">
                            {fullPath(item.parent_id, data).replace(/^全部位置\s*\/\s*/, '')}
                          </span>
                          <span>
                            {specification(sku)}
                            {specification(sku) && facts ? ' · ' : ''}
                            {facts}
                          </span>
                          {date.date && (
                            <span
                              className={
                                itemAttention(item, data).includes('past') ? 'stash-date-past' : ''
                              }
                            >
                              {date.title} {date.date}
                              {itemAttention(item, data).includes('past') ? ' · 日期已过' : ''}
                            </span>
                          )}
                          {query &&
                            note?.body
                              .toLocaleLowerCase()
                              .includes(query.trim().toLocaleLowerCase()) && (
                              <span className="stash-note-match">
                                笔记：{note.body.slice(0, 100)}
                              </span>
                            )}
                        </span>
                        <span className="wb-instance-id" title={item.id}>
                          尾号 {item.id.slice(-8)}
                        </span>
                      </Button>
                    </div>
                  );
                })}
                {productMode && group.items.length > 20 && (
                  <Pagination
                    size="small"
                    aria-label={`${group.title}实物分页`}
                    current={page}
                    pageSize={20}
                    total={group.items.length}
                    showSizeChanger={false}
                    showTotal={(n) => `本组 ${n} 件，每页 20 件`}
                    onChange={(n) => changePage(group.id, n)}
                  />
                )}
              </div>
            )}
          </section>
        );
      })}
      {!groups.length && (
        <Typography.Paragraph className="stash-empty">
          没有匹配的物品。可以调整筛选，或添加物品。
        </Typography.Paragraph>
      )}
    </div>
  );
}
