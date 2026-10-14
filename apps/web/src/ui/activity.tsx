import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Collapse, Skeleton, Typography } from 'antd';
import { Link } from '@tanstack/react-router';
import { read } from '../lib/api';
import { useSession } from '../lib/session';
import { useInventory } from '../lib/inventory';
import { eventNames, time, label } from '../lib/presentation';
import { itemName, type HistoryEvent } from '../../../../packages/contracts/src/web';
import { Notice } from './components';
import { definitions } from './fields';
function readable(value: unknown): string {
  if (value === null || value === undefined) return '未记录';
  if (typeof value === 'object') {
    if ('value' in value && 'unit' in value)
      return `${String(value.value)} ${label(String(value.unit))}`;
    return Object.values(value).map(readable).join(' · ');
  }
  return label(String(value));
}
const fieldLabels: Record<string, string> = {
  parent_id: '存放位置',
  display_name: '名称',
  catalog_node_id: '商品关联',
  name: '名称',
  ...Object.fromEntries(
    Object.entries(definitions).flatMap(([t, fields]) =>
      fields.map((f) => [`attributes.${t}.${f.path}`, f.label]),
    ),
  ),
};
export function EventChanges({ event }: { event: HistoryEvent }) {
  const { data } = useInventory();
  const display = (path: string, value: unknown) => {
    if (typeof value === 'string' && path === 'parent_id') {
      const item = data.items.find((i) => i.id === value);
      return item ? itemName(item, data) : '原位置不可用';
    }
    if (typeof value === 'string' && path === 'catalog_node_id')
      return data.catalog.find((c) => c.id === value)?.name ?? '原商品不可用';
    return readable(value);
  };
  return (
    <>
      {event.changes
        .filter((c) => !c.path.endsWith('.$binding'))
        .map((c, index) => (
          <p key={index}>
            {fieldLabels[c.path] ?? (c.path.startsWith('notes.') ? '笔记' : '资料')}：
            {display(c.path, c.before)} → {display(c.path, c.after)}
          </p>
        ))}
    </>
  );
}
type HistoryPage = { data: HistoryEvent[]; next_cursor?: string };
function useHistoryPages(operation?: string) {
  const { session, online } = useSession();
  const { data, stale } = useInventory();
  return useInfiniteQuery({
    queryKey: ['activity', session.cache_key, data.cached_at, operation],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      read<HistoryPage>(
        'get_history',
        {
          limit: 100,
          ...(pageParam ? { cursor: pageParam } : {}),
          ...(operation ? { operation_id: operation } : {}),
        },
        signal,
      ),
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: online && !stale,
    retry: false,
  });
}
function OperationDetails({ operation }: { operation: string }) {
  const q = useHistoryPages(operation);
  const { data } = useInventory();
  return (
    <>
      {q.isLoading && <Skeleton paragraph={{ rows: 2 }} />}
      {q.data?.pages
        .flatMap((p) => p.data)
        .map((event) => {
          const item = data.items.find((i) => i.id === event.target_id);
          const catalog = data.catalog.find((c) => c.id === event.target_id);
          return (
            <article key={event.id}>
              <strong>{eventNames[event.event_type] ?? event.event_type}</strong>
              {event.target_id && (
                <p>
                  <Link
                    to={
                      event.target_kind === 'ITEM'
                        ? `/items/${event.target_id}`
                        : `/catalog/${event.target_id}`
                    }
                  >
                    {item ? itemName(item, data) : (catalog?.name ?? '查看相关对象')}
                  </Link>
                </p>
              )}
              <EventChanges event={event} />
              {event.reason && <p>原因：{event.reason}</p>}
            </article>
          );
        })}
      {q.isError && <Button onClick={() => void q.refetch()}>读取失败，重试</Button>}
      {q.hasNextPage && (
        <Button loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          继续读取本次操作
        </Button>
      )}
    </>
  );
}
export function Activity() {
  const q = useHistoryPages();
  const { online } = useSession();
  const { stale } = useInventory();
  const groups = new Map<string, HistoryEvent>();
  for (const event of q.data?.pages.flatMap((p) => p.data) ?? []) {
    const key = event.operation_id ?? event.id;
    if (!groups.has(key)) groups.set(key, event);
  }
  return (
    <section className="stash-activity">
      <Typography.Title level={1}>动态</Typography.Title>
      <Typography.Paragraph type="secondary">
        家中最近的变化 · 同一次操作归在一起
      </Typography.Paragraph>
      {(!online || stale) && <Notice>联网后可读取家庭动态，已加载内容仍保留。</Notice>}
      {q.isLoading && <Skeleton />}
      {[...groups].map(([id, event]) => (
        <Collapse
          key={id}
          items={[
            {
              key: id,
              label: (
                <>
                  <strong>{eventNames[event.event_type] ?? event.event_type}</strong>
                  <span> · {time(event.occurred_at)}</span>
                </>
              ),
              children: event.operation_id ? (
                <OperationDetails operation={event.operation_id} />
              ) : (
                <EventChanges event={event} />
              ),
            },
          ]}
        />
      ))}
      {!q.isLoading && !q.isError && !groups.size && <p>还没有已加载的动态。</p>}
      {q.isError && <Button onClick={() => void q.refetch()}>读取失败，重试</Button>}
      {q.hasNextPage && (
        <Button loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          加载更早操作
        </Button>
      )}
    </section>
  );
}
