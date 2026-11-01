import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import type { HistoryEventV2 } from '../../../../../packages/contracts/src/read-v2.js';
import { useHistoryQuery } from '../../features/api/query.js';
import { useInventoryView } from '../../features/inventory/view.js';
import { eventNames } from '../../lib/presentation.js';
import { Icon, type IconName } from '../../ui/icons/Icon.js';
import { Button, EmptyState, PageHeader } from '../../ui/primitives/index.js';
import styles from './ActivityScreen.module.css';

const DAY = 86_400_000;
const pad2 = (value: number) => String(value).padStart(2, '0');

/** Household-local calendar day. Invalid timestamps fall back to an explicit unknown group. */
function dateKey(date: Date, timeZone: string): string | null {
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
    const key = `${part('year')}-${part('month')}-${part('day')}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
  } catch {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }
}

function previousDayKey(key: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - DAY).toISOString().slice(0, 10);
}

function dayLabel(key: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '日期未知';
  if (key === today) return '今天';
  if (key === previousDayKey(today)) return '昨天';
  const [year, month, day] = key.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
  const prefix = key.slice(0, 4) === today.slice(0, 4) ? '' : `${year} 年 `;
  return `${prefix}${month} 月 ${day} 日 · ${weekday}`;
}

function clock(occurredAt: string, timeZone: string): string | null {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  };
  try {
    return new Intl.DateTimeFormat('zh-CN', { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('zh-CN', options).format(date);
  }
}

type GlyphTone = 'neutral' | 'info' | 'warning' | 'danger';

const EVENT_GLYPHS: Record<string, { icon: IconName; tone: GlyphTone }> = {
  CREATE: { icon: 'plus', tone: 'neutral' },
  UPDATE: { icon: 'file', tone: 'neutral' },
  EDIT: { icon: 'file', tone: 'neutral' },
  MOVE: { icon: 'map-pin', tone: 'info' },
  OPEN: { icon: 'package', tone: 'neutral' },
  CONSUME_ITEMS: { icon: 'archive', tone: 'warning' },
  CONSUME_CONTENT: { icon: 'soup', tone: 'warning' },
  CORRECT: { icon: 'circle-alert', tone: 'danger' },
  NOTE_CREATE: { icon: 'file', tone: 'neutral' },
  NOTE_UPDATE: { icon: 'file', tone: 'neutral' },
  ATTRIBUTE_BIND: { icon: 'settings', tone: 'neutral' },
  ATTRIBUTE_UPDATE: { icon: 'settings', tone: 'neutral' },
  ATTRIBUTE_REMOVE: { icon: 'settings', tone: 'neutral' },
};

const FALLBACK_GLYPH: { icon: IconName; tone: GlyphTone } = {
  icon: 'activity',
  tone: 'neutral',
};

export function ActivityScreen() {
  const view = useInventoryView();
  const history = useHistoryQuery({ limit: 50 });
  const timeZone = view.household.timezone || 'Asia/Shanghai';

  const itemNames = useMemo(
    () => new Map(view.items.map((item) => [item.id, item.name])),
    [view.items],
  );
  const catalogNames = useMemo(() => {
    const names = new Map(view.catalog.map((node) => [node.id, node.name]));
    for (const group of view.groups) if (!names.has(group.id)) names.set(group.id, group.name);
    return names;
  }, [view.catalog, view.groups]);

  const days = useMemo(() => {
    const grouped = new Map<string, HistoryEventV2[]>();
    for (const event of history.events) {
      const key = dateKey(new Date(event.occurred_at), timeZone) ?? 'unknown';
      const sameDay = grouped.get(key);
      if (sameDay) sameDay.push(event);
      else grouped.set(key, [event]);
    }
    return [...grouped.entries()];
  }, [history.events, timeZone]);

  const today = dateKey(new Date(), timeZone) ?? 'unknown';
  const targetName = (event: HistoryEventV2): string | undefined =>
    event.target_kind === 'ITEM'
      ? itemNames.get(event.target_id)
      : catalogNames.get(event.target_id);
  const empty = !history.isLoading && !history.isError && history.events.length === 0;
  const subtitle = history.isLoading
    ? '正在读取动态…'
    : history.isError
      ? '暂时无法读取'
      : history.events.length > 0
        ? `最近 ${history.events.length} 条变化`
        : '家庭最近发生的变化';

  return (
    <div className={styles.page}>
      <PageHeader title="动态" subtitle={subtitle} />

      {history.stale && !history.isError && (
        <div className={styles.banner} role="status">
          <span>有新变化，刷新查看最新</span>
          <Button variant="secondary" size="sm" onClick={() => void history.refetch()}>
            刷新
          </Button>
        </div>
      )}

      {history.isLoading && (
        <div className={styles.skeletonList} role="status" aria-label="正在读取动态">
          {[0, 1, 2, 3].map((row) => (
            <div className={styles.skeletonRow} key={row} aria-hidden="true">
              <span className={styles.skeletonGlyph} />
              <span className={styles.skeletonLines}>
                <span className={styles.skeletonLine} />
                <span className={styles.skeletonLine} />
              </span>
              <span className={styles.skeletonTime} />
            </div>
          ))}
        </div>
      )}

      {history.isError && (
        <EmptyState
          icon={<Icon name="circle-alert" size={20} />}
          title="动态暂时无法读取"
          description="请检查连接后重试。"
          action={
            <Button variant="secondary" onClick={() => void history.refetch()}>
              重试
            </Button>
          }
        />
      )}

      {empty && (
        <EmptyState
          icon={<Icon name="activity" size={20} />}
          title="还没有动态"
          description="添加第一件物品后，家里发生的变化会出现在这里。"
          action={
            <Link to="/items" search={{ ui: 'next' }} className={styles.emptyLink}>
              查看我的物品
            </Link>
          }
        />
      )}

      {!history.isError &&
        days.map(([key, events]) => (
          <section className={styles.day} key={key}>
            <h2 className={styles.dayTitle}>
              <span>{dayLabel(key, today)}</span>
              <span className={styles.dayCount}>{events.length} 条</span>
            </h2>
            <ul className={styles.events}>
              {events.map((event) => {
                const target = targetName(event);
                const stamp = clock(event.occurred_at, timeZone);
                const glyph = EVENT_GLYPHS[event.event_type] ?? FALLBACK_GLYPH;
                return (
                  <li className={styles.event} key={event.id}>
                    <span className={styles.eventGlyph} data-tone={glyph.tone} aria-hidden="true">
                      <Icon name={glyph.icon} size={16} />
                    </span>
                    <div className={styles.eventBody}>
                      <p className={styles.eventLine}>
                        <strong className={styles.eventAction}>
                          {eventNames[event.event_type] ?? '记录变化'}
                        </strong>
                        {target && <span className={styles.target}>{target}</span>}
                      </p>
                      {event.reason && (
                        <p className={styles.reason}>
                          <span className={styles.reasonLabel}>原因：</span>
                          {event.reason}
                        </p>
                      )}
                    </div>
                    {stamp && (
                      <time className={styles.time} dateTime={event.occurred_at}>
                        {stamp}
                      </time>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

      {!history.isError && history.hasNextPage && (
        <div className={styles.more}>
          <Button
            variant="secondary"
            loading={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            加载更早
          </Button>
        </div>
      )}
    </div>
  );
}
