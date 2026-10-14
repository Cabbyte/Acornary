import { useState } from 'react';
import {
  Button,
  Card,
  Collapse,
  Progress,
  Descriptions,
  Skeleton,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  attr,
  isTerminal,
  itemName,
  type ItemRecord,
} from '../../../../packages/contracts/src/web';
import { history } from '../lib/api';
import { useInventory } from '../lib/inventory';
import { useSession } from '../lib/session';
import { specification } from '../lib/browse';
import { latestNote } from '../lib/workbench';
import { stashDate, remainingPercent } from '../lib/stash';
import { eventNames, remaining, time, label } from '../lib/presentation';
import { useViewport } from './theme';
import { LabelButton } from './label-button';
import { LocationPath } from './browser';
import { EventChanges } from './activity';
import type { Action } from './forms';
export function ItemInspector({
  item,
  open,
  close,
}: {
  item: ItemRecord;
  open: (a: Action) => void;
  close: () => void;
}) {
  const { mobile } = useViewport();
  const { data, stale } = useInventory();
  const { online, session } = useSession();
  const life = attr(item, 'lifecycle');
  const sku = data.catalog.find((c) => c.id === item.catalog_node_id);
  const note = latestNote(data, item.id);
  const date = stashDate(item, data);
  const percent = remainingPercent(item, data);
  const [consumption, setConsumption] = useState(false);
  const events = useQuery({
    queryKey: ['history', session.cache_key, item.id, item.revision],
    queryFn: ({ signal }) => history(item.id, 'ITEM', undefined, signal),
    enabled: online && !stale,
  });
  const disabled = !online || stale || session.can_write === false;
  return (
    <div className="stack" aria-label="物品详情">
      <Space wrap>
        <Button onClick={close}>返回列表</Button>
        <Button
          type="text"
          aria-label="关闭详情"
          icon={<CloseOutlined aria-hidden="true" />}
          onClick={close}
        />
        <Link to={`/items/${item.id}/details`}>更多资料与操作</Link>
      </Space>
      <Typography.Title
        id="stash-dossier-heading"
        tabIndex={-1}
        level={mobile ? 1 : 2}
        className="wb-detail-heading"
      >
        {itemName(item, data)}
      </Typography.Title>
      <Typography.Text type="secondary">{specification(sku) || '规格未记录'}</Typography.Text>
      <LocationPath id={item.parent_id} />
      <Space wrap>
        {life?.state && <Tag>库存：{label(life.state)}</Tag>}
        {life?.availability && <Tag>可用性：{label(life.availability)}</Tag>}
        {life?.opening?.state && <Tag>{label(life.opening.state)}</Tag>}
        {life?.condition && <Tag>状况：{label(life.condition)}</Tag>}
      </Space>
      {attr(item, 'contents')?.remaining && (
        <div className="stash-remaining">
          <Typography.Text type="secondary">当前剩余</Typography.Text>
          <strong>{remaining(item)}</strong>
          {percent !== undefined && (
            <>
              <Progress percent={Math.min(100, percent)} showInfo={false} strokeColor="#AB5F40" />
              <small>
                {attr(item, 'contents')?.remaining?.unit === 'percent'
                  ? '已记录比例'
                  : '相对标称净含量'}
              </small>
            </>
          )}
        </div>
      )}
      {date.date && (
        <p title={date.basis.join('；')}>
          {date.title}：<strong>{date.date}</strong>
          {date.basis.length > 1 && <small> · 已记录日期与开封后期限取较早者</small>}
        </p>
      )}
      <Button
        type="primary"
        disabled={disabled || isTerminal(item)}
        onClick={() => setConsumption(!consumption)}
      >
        记录消耗
      </Button>
      {consumption && (
        <div className="stash-consumption stack">
          <Typography.Text>这次如何使用？</Typography.Text>
          {attr(item, 'contents')?.remaining ? (
            <Button onClick={() => open({ kind: 'consume', target: item.id })}>用掉一部分</Button>
          ) : (
            <>
              <Typography.Text type="secondary">按量消耗前，请先记录已知余量。</Typography.Text>
              <Button
                onClick={() => open({ kind: 'attributes', target: item.id, template: 'contents' })}
              >
                记录余量
              </Button>
            </>
          )}
          <Button onClick={() => open({ kind: 'finish', target: item.id })}>整件用完</Button>
        </div>
      )}
      <Space>
        <Button
          disabled={disabled || isTerminal(item)}
          onClick={() => open({ kind: 'move', target: item.id })}
        >
          移动
        </Button>
        <Button
          id={`edit-item-${item.id}`}
          disabled={disabled}
          onClick={(event) => {
            // Safari does not focus buttons on pointer activation; retain the return target.
            event.currentTarget.focus({ preventScroll: true });
            open({ kind: 'edit', target: item.id, note: note?.id });
          }}
        >
          编辑
        </Button>
      </Space>
      <Descriptions
        title="物品资料"
        column={1}
        items={[
          { key: 'place', label: '位置', children: <LocationPath id={item.parent_id} /> },
          { key: 'spec', label: '规格', children: specification(sku) || '未记录' },
          { key: 'date', label: '购入日期', children: life?.acquisition?.acquired_on || '未记录' },
          ...(attr(item, 'contents')?.remaining
            ? [{ key: 'remaining', label: '剩余量', children: remaining(item) }]
            : []),
        ]}
      />
      <Card
        size="small"
        title="笔记"
        extra={
          <Button
            type="link"
            disabled={disabled}
            onClick={() => open({ kind: 'note', target: item.id, note: note?.id })}
          >
            {note ? '编辑笔记' : '添加笔记'}
          </Button>
        }
      >
        <p className="stash-note">{note?.body || '还没有笔记'}</p>
        <Link to={`/items/${item.id}/notes`}>全部笔记</Link>
      </Card>
      <Space wrap>
        {!life?.opening?.opened_at && !isTerminal(item) && (
          <Button disabled={disabled} onClick={() => open({ kind: 'open', target: item.id })}>
            记录开封
          </Button>
        )}
        <LabelButton
          disabled={!online || stale}
          onClick={() => open({ kind: 'print', target: item.id })}
        />
      </Space>
      <Collapse
        items={[
          {
            key: 'technical',
            label: '技术信息',
            children: (
              <>
                <Typography.Text copyable>{item.id}</Typography.Text>
                <p>版本 {item.revision}</p>
              </>
            ),
          },
        ]}
      />
      <Card size="small" title="最近动态">
        {events.isFetching ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : (
          <Timeline
            items={events.data?.data.slice(0, 3).map((event) => ({
              key: event.id,
              content: (
                <>
                  <Typography.Text type="secondary">{time(event.occurred_at)}</Typography.Text>
                  <p>{eventNames[event.event_type] ?? event.event_type}</p>
                  <EventChanges event={event} />
                </>
              ),
            }))}
          />
        )}
        {events.isError && (
          <Button onClick={() => void events.refetch()}>动态读取失败，重试</Button>
        )}
        {!online && <Typography.Text type="secondary">联网后可查看最新动态</Typography.Text>}
        <Link to={`/items/${item.id}/history`}>查看全部动态</Link>
      </Card>
      <Link
        to={`/items/${item.id}/details`}
        search={{
          returnTo: item.parent_id
            ? `/places/${item.parent_id}?item=${item.id}`
            : `/items?item=${item.id}`,
        }}
      >
        更多资料、消耗与笔记 ›
      </Link>
    </div>
  );
}
