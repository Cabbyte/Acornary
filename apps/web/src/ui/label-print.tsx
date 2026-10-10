import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Select, Space, Tag } from 'antd';
import { itemName } from '../../../../packages/contracts/src/web';
import { useInventory } from '../lib/inventory';
import { useSession } from '../lib/session';
import { embeddedRuntime } from '../lib/runtime';
import {
  canPrintLabels,
  itemDate,
  itemLabelURL,
  printLabelBatch,
  type LabelStatus,
} from '../lib/labels';
import { renderLabel } from '../lib/label-renderer';
import { D101Printer } from '../lib/d101-printer';
import { snapshot } from '../lib/api';
import { ActionDrawer, Notice } from './components';

const statuses = {
  pending: '待打印',
  printing: '正在打印',
  done: '打印机已确认',
  uncertain: '出纸结果待核对',
};
export default function LabelPrint({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { data, stale, refresh } = useInventory();
  const { session, online, expired } = useSession();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [density, setDensity] = useState(2);
  const [journal, setJournal] = useState<Record<string, LabelStatus>>({});
  const [chosen, setChosen] = useState(ids);
  const [reviewed, setReviewed] = useState(false);
  const printer = useRef<D101Printer | null>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const lock = useRef(false);
  const permitted = canPrintLabels() && !embeddedRuntime();
  const available = permitted && online && !stale && !expired;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      void printer.current?.close().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!available) {
      controller.current?.abort();
      void printer.current?.close().catch(() => {});
      printer.current = null;
      setConnected(false);
    }
  }, [available]);
  const prepared = useMemo(() => {
    try {
      if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length)
        throw new Error('请选择 1–100 件不同的物品。');
      const pages = ids.map((id) => {
        const item = data.items.find((i) => i.id === id);
        if (!item) throw new Error('部分物品在当前家庭中不可用，请返回重新选择。');
        const name = itemName(item, data),
          date = itemDate(item);
        const url = itemLabelURL(id, window.location.origin);
        const image = renderLabel(name, date.title, date.date, url);
        return {
          id,
          name,
          image,
          preview: image.toDataURL(),
          url,
          revision: item.revision,
          catalogRevision: data.catalog.find((c) => c.id === item.catalog_node_id)?.revision,
        };
      });
      return { pages, error: '' };
    } catch (e) {
      return { pages: [], error: (e as Error).message };
    }
  }, [data, ids]);
  const uncertain = Object.values(journal).includes('uncertain');
  async function connect() {
    if (lock.current || connecting || !available) return;
    setConnecting(true);
    setError('');
    // Construct before connecting: requestDevice must retain the button's user activation.
    const next = new D101Printer(() => {
      if (alive.current) setConnected(false);
    });
    printer.current = next;
    try {
      await next.connect();
      if (alive.current) setConnected(true);
    } catch (e) {
      await next.close().catch(() => {});
      if (alive.current) setError(`连接未完成：${(e as Error).message}`);
    } finally {
      if (alive.current) setConnecting(false);
    }
  }
  async function print() {
    if (
      lock.current ||
      !available ||
      !connected ||
      !printer.current ||
      prepared.error ||
      !chosen.length ||
      (uncertain && !reviewed)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      const latest = await snapshot(session.household_id, abort.signal);
      if (!alive.current || abort.signal.aborted) return;
      if (
        latest.household.id !== data.household.id ||
        prepared.pages.some((page) => {
          const item = latest.items.find((i) => i.id === page.id);
          return (
            !item ||
            item.revision !== page.revision ||
            latest.catalog.find((c) => c.id === item.catalog_node_id)?.revision !==
              page.catalogRevision
          );
        })
      ) {
        await refresh();
        throw new Error('物品资料已变化，预览已更新，请核对后再次打印。');
      }
      printer.current.density = density;
      setReviewed(false);
      await printLabelBatch(
        prepared.pages.filter((p) => chosen.includes(p.id)),
        printer.current,
        abort.signal,
        (id, status) => {
          if (!alive.current) return;
          setJournal((old) => ({ ...old, [id]: status }));
          if (status === 'done' || status === 'uncertain')
            setChosen((old) => old.filter((v) => v !== id));
        },
      );
    } catch (e) {
      if (alive.current) setError(`已停止，未自动重打。${(e as Error).message}`);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <ActionDrawer title="打印标签" onClose={onClose} busy={busy || connecting}>
      <div className="stack">
        <p>D101 · 30 × 12 mm · {ids.length} 件物品 · 每件一张</p>
        {!permitted && <Notice>请在 Mac 的 Chrome 独立网页中连接 D101 打印。</Notice>}
        {!available && permitted && <Notice>请联网并登录后打印最新的物品资料。</Notice>}
        <Space wrap>
          <Tag>{connected ? 'D101 已连接' : '打印机未连接'}</Tag>
          <Button
            disabled={!available || busy || connected || connecting}
            loading={connecting}
            onClick={() => void connect()}
          >
            连接 D101
          </Button>
          <Select
            aria-label="打印浓度"
            value={density}
            disabled={busy}
            onChange={setDensity}
            options={[1, 2, 3].map((v) => ({
              value: v,
              label: `浓度 ${v}${v === 2 ? '（默认）' : ''}`,
            }))}
          />
        </Space>
        <p>首次请先只勾选一张试印，核对文字方向、边距和手机扫码效果。预览为放大显示。</p>
        {prepared.error && <Notice danger>{prepared.error}</Notice>}
        {prepared.pages.map((page) => (
          <div key={page.id} className="label-preview-row">
            <Checkbox
              disabled={busy}
              checked={chosen.includes(page.id)}
              onChange={(e) => {
                setReviewed(false);
                setChosen((old) =>
                  e.target.checked ? [...old, page.id] : old.filter((v) => v !== page.id),
                );
              }}
            >
              {page.name}
            </Checkbox>
            <img
              className="label-preview"
              src={page.preview}
              width={240}
              height={96}
              alt={`${page.name}的标签预览`}
            />
            <span role="status">{statuses[journal[page.id] ?? 'pending']}</span>
          </div>
        ))}
        {error && <Notice danger>{error}</Notice>}
        {uncertain && (
          <Checkbox
            checked={reviewed}
            disabled={busy}
            onChange={(e) => setReviewed(e.target.checked)}
          >
            我已核对实际出纸情况，勾选的物品确实需要打印
          </Checkbox>
        )}
        <Space wrap>
          <Button
            type="primary"
            loading={busy}
            disabled={
              !available ||
              !connected ||
              connecting ||
              !!prepared.error ||
              !chosen.length ||
              (uncertain && !reviewed)
            }
            onClick={() => void print()}
          >
            打印勾选的 {chosen.length} 张标签
          </Button>
          {busy && <Button onClick={() => controller.current?.abort()}>停止后续打印</Button>}
        </Space>
        <small>补打只打印标签，不会再次入库。停止后，当前一张仍可能出纸；请核对后再补打。</small>
      </div>
    </ActionDrawer>
  );
}
