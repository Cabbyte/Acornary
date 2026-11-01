import { useFeature } from '../../features/api/connection.js';
import { useSession } from '../../lib/session.js';
import { writeCapabilities } from '../../features/writes/selectors.js';
import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHistoryQuery } from '../../features/api/query.js';
import { adaptItemDetail } from '../../features/inventory/adapters/detail.js';
import type { ItemDetailView } from '../../features/inventory/model/types.js';
import { useInventoryView } from '../../features/inventory/view.js';
import { useInventory } from '../../lib/inventory.js';
import { attentionFor, categoryPath, todayFor } from '../../features/items/selectors/items.js';
import { categoryIcon, categoryTone } from '../../ui/icons/category.js';
import { Icon } from '../../ui/icons/Icon.js';
import { ApiError, read } from '../../lib/api.js';
import { eventNames, time } from '../../lib/presentation.js';
import type { Action } from '../../ui/forms';
import {
  Button,
  EmptyState,
  Metric,
  PageHeader,
  Section,
  StatusTag,
} from '../../ui/primitives/index.js';
import styles from './ItemScreen.module.css';

const ITEMS_PATH = '/items?ui=next';

/** Only same-origin item surfaces are accepted; never use returnTo as a redirect target. */
function safeReturnTo(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = new URLSearchParams(window.location.search).get('returnTo');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\\\r\n]/.test(raw))
    return undefined;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return undefined;
    if (!/^\/(items|places|search|catalog)(?:\/|$)/.test(url.pathname)) return undefined;
    return url.pathname + url.search + url.hash;
  } catch {
    return undefined;
  }
}

const dueText = (dueOn: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(dueOn) ? dueOn.slice(5) : dueOn;

const isNotFound = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'NOT_FOUND';

export function ItemScreen({ id, open }: { id: string; open: (action: Action) => void }) {
  const view = useInventoryView();
  const { session, online } = useSession();
  const attachmentsEnabled = useFeature('attachments');
  const redactionEnabled = useFeature('redaction_v2');
  const profileEnabled = useFeature('profile_capabilities');
  const { data: inventory } = useInventory();
  const capabilities = writeCapabilities(
    inventory.items.find((item) => item.id === id),
    profileEnabled,
  );
  const writable = online && session.can_write !== false;
  const backHref = useMemo(() => safeReturnTo() ?? ITEMS_PATH, []);
  const detailQuery = useQuery({
    queryKey: ['item-detail', session.cache_key, id, view.asOfChangeId, view.cachedAt],
    queryFn: ({ signal }) => read<unknown>('get_item', { item_id: id, include_path: true }, signal),
    retry: false,
  });
  const detail = useMemo<ItemDetailView | null>(
    () => (detailQuery.data === undefined ? null : adaptItemDetail(detailQuery.data, view)),
    [detailQuery.data, view],
  );
  const history = useHistoryQuery({ target: { kind: 'ITEM', id }, limit: 20 });
  const inventoryKey = `${view.asOfChangeId}:${view.cachedAt}`;
  const seenInventoryKey = useRef(inventoryKey);
  const refetchHistory = history.refetch;
  useEffect(() => {
    if (seenInventoryKey.current === inventoryKey) return;
    seenInventoryKey.current = inventoryKey;
    void refetchHistory();
  }, [inventoryKey, refetchHistory]);
  const catalog = useMemo(
    () => new Map(view.catalog.map((node) => [node.id, node])),
    [view.catalog],
  );
  const today = todayFor(inventory.household.timezone ?? 'Asia/Shanghai');
  const back = { label: '我的物品', href: backHref };

  if (!detail) {
    const failed = detailQuery.isError;
    const notFound = isNotFound(detailQuery.error);
    return (
      <div className={styles.screen}>
        <PageHeader
          back={back}
          title="物品档案"
          subtitle={failed ? undefined : '正在读取这件物品'}
        />
        {failed ? (
          <EmptyState
            title={notFound ? '这件物品已不可用' : '物品档案读取失败'}
            description={
              notFound
                ? '这件物品可能已被删除，或属于其他家庭。'
                : (detailQuery.error?.message ?? '请检查连接后重试。')
            }
            action={
              <div className={styles.errorActions}>
                {!notFound && (
                  <Button variant="secondary" onClick={() => void detailQuery.refetch()}>
                    重试
                  </Button>
                )}
                <a className={styles.backLink} href={backHref}>
                  返回我的物品
                </a>
              </div>
            }
          />
        ) : (
          <div className={styles.skeleton} role="status" aria-label="正在读取物品档案">
            <span className={styles.skeletonBar} />
            <span className={styles.skeletonShort} />
            <span className={styles.skeletonBlock} />
          </div>
        )}
      </div>
    );
  }

  const item = detail.item;
  const remaining = item.facts.find((fact) => fact.kind === 'remaining');
  const nextDate = detail.dates[0];
  const extraDates = detail.dates.filter(
    (date) => !item.facts.some((fact) => fact.kind === 'expiry' && fact.value === date.dueOn),
  );
  const recordedCount = item.facts.length + extraDates.length + (item.subtitle ? 1 : 0);
  const edit = () => open({ kind: 'edit', target: id });
  const category = categoryPath(item, catalog)[0] ?? '其他';
  const product = catalog.get(item.skuId)?.name ?? item.name;
  const attention = attentionFor(item, today);
  const dateLabel = attention?.label ?? (nextDate ? `${dueText(nextDate.dueOn)} 到期` : '未记录');

  return (
    <div className={styles.screen}>
      <PageHeader
        back={back}
        title={item.name}
        subtitle={item.location.label}
        actions={
          <Button variant="secondary" disabled={!writable} onClick={edit}>
            编辑
          </Button>
        }
      />

      <div className={styles.identity}>
        <span className={styles.glyph} data-tone={categoryTone(category)}>
          <Icon name={categoryIcon(item.name, product, category)} size={20} />
        </span>
        <div className={styles.identityCopy}>
          <strong>{product}</strong>
          <span>{category}</span>
        </div>
        <StatusTag tone={item.status.tone}>{item.status.label}</StatusTag>
        {redactionEnabled && item.redactedPaths.length > 0 && (
          <StatusTag tone="neutral">部分资料已隐藏</StatusTag>
        )}
      </div>

      <div className={styles.metrics}>
        <Metric label="剩余" value={remaining?.value ?? '未记录'} />
        <Metric label="到期" value={dateLabel} hint={nextDate?.label} />
        <Metric label="记录" value={`${recordedCount} 项`} />
      </div>

      <div className={styles.actionBar}>
        <Button
          variant="primary"
          disabled={!writable || !capabilities.consume}
          onClick={() => open({ kind: 'consume', target: id })}
        >
          <Icon name="minus" size={15} />
          记录消耗
        </Button>
        <Button
          variant="secondary"
          disabled={!writable || !capabilities.active}
          onClick={() => open({ kind: 'move', target: id })}
        >
          <Icon name="map-pin" size={15} />
          移动
        </Button>
      </div>

      <Section title="更多" collapsible defaultOpen={false}>
        <div className={styles.moreActions}>
          <Button
            variant="secondary"
            disabled={!writable || !capabilities.open}
            onClick={() => open({ kind: 'open', target: id })}
          >
            记录开封
          </Button>
          <Button
            variant="danger"
            disabled={!writable || !capabilities.active}
            onClick={() => open({ kind: 'finish', target: id })}
          >
            整件用完
          </Button>
          <Button variant="quiet" onClick={() => open({ kind: 'print', target: id })}>
            打印
          </Button>
        </div>
      </Section>

      <Section
        title="资料"
        description={recordedCount > 0 ? `已记录 ${recordedCount} 项` : undefined}
      >
        {recordedCount > 0 ? (
          <>
            {item.subtitle && <p className={styles.identityText}>{item.subtitle}</p>}
            {(item.facts.length > 0 || extraDates.length > 0) && (
              <ul className={styles.facts}>
                {item.facts.map((fact) => (
                  <li key={`${fact.kind}:${fact.value}`} className={styles.fact}>
                    <span>{fact.label}</span>
                    <strong>{fact.value}</strong>
                  </li>
                ))}
                {extraDates.map((date) => (
                  <li key={`${date.key}:${date.dueOn}`} className={styles.fact}>
                    <span>{date.label}</span>
                    <strong>{date.dueOn}</strong>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className={styles.emptyLine}>
            <span>还没有补充资料</span>
            <Button variant="quiet" onClick={edit}>
              补充资料
            </Button>
          </div>
        )}
      </Section>

      <Section
        title="笔记"
        description={detail.notes.length > 0 ? `${detail.notes.length} 条` : undefined}
        action={
          <Button
            variant="secondary"
            disabled={!writable}
            onClick={() => open({ kind: 'note', target: id })}
          >
            添加笔记
          </Button>
        }
      >
        {detail.notes.length > 0 ? (
          <ul className={styles.notes}>
            {detail.notes.slice(0, 3).map((note) => (
              <li key={note.id} className={styles.note}>
                {note.title && <p className={styles.noteTitle}>{note.title}</p>}
                <p className={styles.noteText}>{note.excerpt || note.title || '未命名笔记'}</p>
                <time className={styles.noteMeta} dateTime={note.updatedAt}>
                  {time(note.updatedAt)}
                </time>
                <Button
                  variant="quiet"
                  disabled={!writable}
                  onClick={() => open({ kind: 'note', target: id, note: note.id })}
                >
                  编辑笔记
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>还没有笔记。</p>
        )}
      </Section>

      {attachmentsEnabled && detail.attachments.length > 0 && (
        <Section title="附件" description={`${detail.attachments.length} 个`}>
          <ul className={styles.attachments}>
            {detail.attachments.map((attachment) => (
              <li key={attachment.id} className={styles.attachment}>
                <span className={styles.attachmentName}>{attachment.caption ?? '未命名附件'}</span>
                <span className={styles.attachmentMeta}>{attachment.mimeType}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="最近变化"
        description={history.events.length > 0 ? `最近 ${history.events.length} 条` : undefined}
      >
        {history.error && (
          <div className={styles.historyError} role="alert">
            <span>{history.error.message}</span>
            <Button variant="quiet" onClick={() => void history.refetch()}>
              重试
            </Button>
          </div>
        )}
        {history.isPending ? (
          <p className={styles.muted} role="status">
            正在读取最近变化…
          </p>
        ) : history.events.length > 0 ? (
          <ul className={styles.history}>
            {history.events.map((event) => (
              <li key={event.id} className={styles.event}>
                <div className={styles.eventHead}>
                  <span className={styles.eventName}>
                    {eventNames[event.event_type] ?? '变更记录'}
                  </span>
                  <time className={styles.noteMeta} dateTime={event.occurred_at}>
                    {time(event.occurred_at)}
                  </time>
                </div>
                {event.reason && <p className={styles.reason}>原因：{event.reason}</p>}
              </li>
            ))}
          </ul>
        ) : (
          !history.error && <p className={styles.muted}>还没有变化记录。</p>
        )}
      </Section>

      <details className={styles.technical}>
        <summary>技术信息</summary>
        <dl>
          <div>
            <dt>物品 ID</dt>
            <dd>{item.id}</dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>{item.revision}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
