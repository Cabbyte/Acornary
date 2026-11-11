import { ReviewNote, ReviewFeedback } from '../review-frame';
import { useEffect, useMemo, useState } from 'react';
import {
  DataTable,
  type DataTableColumn,
  type DataTableSorting,
} from '../../src/ui/components/ui/data-table';
import { PaginationControls } from '../../src/ui/components/ui/pagination-controls';
import { ItemStatus, type ItemStatusFact } from '../../src/ui/patterns/item-status';
import { PageHeader } from '../../src/ui/patterns/page-header';
import { ProductSummary } from '../../src/ui/patterns/product-summary';
import { ItemRow, type ItemRowProps } from '../../src/ui/patterns/item-row';
import { ItemCard } from '../../src/ui/patterns/item-card';
import { AttentionSummary, type AttentionCategory } from '../../src/ui/patterns/attention-summary';
import { BatchSelectionBar } from '../../src/ui/patterns/batch-selection-bar';
import { ItemIdentity } from '../../src/ui/patterns/item-identity';
import { QuantityValue } from '../../src/ui/patterns/quantity-value';
import { LocationPath } from '../../src/ui/patterns/location-path';
import { Button } from '../../src/ui/components/ui/button';
import type {
  ActionAvailability,
  DateFactPresentation,
  ItemView,
  QuantityPresentation,
} from '../../src/ui/patterns/types';
import { group, householdId, items, skuId } from '../fixtures';
import type { ReviewDemoProps, ReviewEntry, ReviewScenario } from '../types';

// Deterministic fixture identities are created once and retained across sort/page changes.
const fixtureId = (seed: number) =>
  `item_10000000-0000-4000-8000-${String(seed).padStart(12, '0')}`;
const hiddenItemId = fixtureId(900);
const pantryId = fixtureId(901);
type DemoItem = ItemView & { quantity: QuantityPresentation };
const tableItems: DemoItem[] = Array.from({ length: 12 }, (_, seed) => ({
  ...[
    items[0],
    items[2],
    {
      ...items[0],
      skuId: 'catalog_node_00000000-0000-4000-8000-000000000003',
      subtitle: '中烘焙 · 250 g',
      status: { label: '未开封', tone: 'neutral' as const },
      facts: [],
    },
  ][seed % 3],
  id: fixtureId(seed + 1),
  name: `${['燕麦饮', '玻璃保鲜盒', '咖啡豆'][seed % 3]} ${String(seed + 1).padStart(2, '0')}`,
  quantity:
    seed % 3 === 0
      ? { value: '310.00', unit: 'mL', accuracy: 'estimated' }
      : seed % 3 === 1
        ? { value: null, unit: '个', accuracy: 'unknown' }
        : { value: '0.2500', unit: 'kg', accuracy: 'measured' },
}));
const dateFixture: DateFactPresentation = {
  kind: 'EXPIRY',
  dateKind: 'BEST_BEFORE',
  dueOn: '2026-12-08',
  basis: '包装标签',
  state: 'UPCOMING',
  source: 'LIFECYCLE',
  label: '未开封最佳食用期',
};
const knownQuantity: QuantityPresentation = { value: '310.00', unit: 'mL', accuracy: 'estimated' };
const available: ActionAvailability = { kind: 'available' };

function DemoMessage({ children }: { children: string }) {
  return <ReviewFeedback>{children}</ReviewFeedback>;
}

export const dataTableScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '受控排序 / 筛选 / 分页' },
  { id: 'alignment', label: '跨列详情与摘要锚点' },
  { id: 'selected', label: '逐件选择' },
  { id: 'hidden-selection', label: '跨页隐藏选择' },
  { id: 'unavailable', label: '不可选物品' },
  { id: 'multiple-locations', label: '多个位置' },
  { id: 'unknown-total', label: '总数未知' },
  { id: 'empty', label: '空范围' },
  { id: 'unknown', label: '未取得结果' },
  { id: 'loading', label: '加载中保留旧页' },
  { id: 'error', label: '读取失败' },
  { id: 'readonly', label: '只读选择' },
  { id: 'disabled', label: '禁用' },
  { id: 'long-text', label: '长名称' },
];
export const paginationControlsScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '已知服务器总数' },
  { id: 'unknown-total', label: '未知总数 / 游标可用性' },
  { id: 'last-page', label: '末页不足一页' },
  { id: 'empty', label: '已知为空' },
  { id: 'loading', label: '加载中' },
  { id: 'disabled', label: '禁用' },
];
export const itemStatusScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '多维状态' },
  { id: 'unknown', label: '未知不等于可用' },
  { id: 'void', label: '作废记录' },
  { id: 'readonly', label: '只读权限' },
  { id: 'unavailable', label: '缺少必要事实' },
  { id: 'loading', label: '加载中' },
  { id: 'long-text', label: '长状态说明' },
];
export const pageHeaderScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '标题 / 上下文 / 意图' },
  { id: 'long-text', label: '长标题' },
  { id: 'readonly', label: '只读' },
  { id: 'busy', label: '处理中' },
  { id: 'unavailable', label: '宿主能力不足' },
  { id: 'minimal', label: '仅标题' },
];
export const productSummaryScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '已知合计和未知数量' },
  { id: 'multiple-units', label: '多单位不混加' },
  { id: 'multiple-locations', label: '多个位置' },
  { id: 'unknown-count', label: '物品总数未知' },
  { id: 'unknown', label: '汇总未知' },
  { id: 'empty', label: '明确为零' },
  { id: 'cached', label: '缓存子集' },
  { id: 'readonly', label: '只读' },
  { id: 'loading', label: '加载中' },
  { id: 'error', label: '读取失败' },
  { id: 'long-text', label: '长商品名称' },
];
export const itemRowScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '事实与操作意图' },
  { id: 'alignment', label: '混合选择 / 动作 / 未知事实' },
  { id: 'selected', label: '已选具体物品' },
  { id: 'unknown', label: '数量 / 日期 / 位置未知' },
  { id: 'zero', label: '数量为零' },
  { id: 'multiple-locations', label: '同商品不同位置' },
  { id: 'readonly', label: '只读' },
  { id: 'unavailable', label: '缺少操作事实' },
  { id: 'redacted', label: '名称不可见' },
  { id: 'loading', label: '刷新中' },
  { id: 'error', label: '刷新失败' },
  { id: 'long-text', label: '长名称' },
];
export const attentionSummaryScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '日期 / 数量 / 任务' },
  { id: 'zero', label: '各项明确为零' },
  { id: 'unknown', label: '计数与范围未知' },
  { id: 'cached', label: '缓存 / 过时' },
  { id: 'empty', label: '未提供类别' },
  { id: 'loading', label: '加载中' },
  { id: 'error', label: '读取错误' },
  { id: 'disabled', label: '禁用入口' },
  { id: 'long-text', label: '长类别说明' },
];
export const batchSelectionBarScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '具体物品与版本' },
  { id: 'empty', label: '未选择' },
  { id: 'hidden-selection', label: '隐藏选择' },
  { id: 'unavailable', label: '不可用选择' },
  { id: 'limit-100', label: '100 件边界' },
  { id: 'over-limit-101', label: '101 件阻断' },
  { id: 'wrong-identity', label: '商品 ID 不能批量授权' },
  { id: 'readonly', label: '只读' },
  { id: 'busy', label: '处理中' },
  { id: 'offline', label: '离线阻断' },
];

export function DataTableDemo({ scenario }: ReviewDemoProps) {
  const [sorting, setSorting] = useState<DataTableSorting>([]);
  const [query, setQuery] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setSorting([]);
    setQuery('');
    setPageIndex(0);
    setSelectedIds(
      scenario === 'selected'
        ? [tableItems[0].id]
        : scenario === 'hidden-selection'
          ? [tableItems[0].id, tableItems[7].id, hiddenItemId]
          : [],
    );
    setExpandedIds([]);
  }, [scenario]);
  const dataset = useMemo(
    () =>
      scenario === 'empty' || scenario === 'unknown'
        ? []
        : tableItems.map((item) => ({
            ...item,
            name:
              scenario === 'long-text'
                ? `${item.name} · 常温保存的家庭分享装 · 完整批次标签与购买备注`
                : item.name,
            location:
              scenario === 'multiple-locations' && item.id === tableItems[0].id
                ? { id: pantryId, path: ['厨房', '备用食品柜', '上层'], label: '备用食品柜上层' }
                : item.location,
          })),
    [scenario],
  );
  // This isolated fixture owns all twelve records. Production DataTable receives a server page only.
  const filtered = dataset.filter((item) =>
    `${item.name} ${item.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const ordered = sorting.length
    ? [...filtered].sort((a, b) => (sorting[0].desc ? -1 : 1) * a.name.localeCompare(b.name, 'zh'))
    : filtered;
  const rows = ordered.slice(pageIndex * 3, pageIndex * 3 + 3);
  const columns = useMemo<readonly DataTableColumn<DemoItem>[]>(
    () => [
      {
        id: 'name',
        label: '物品',
        sortable: true,
        cell: (row) => (
          <ItemIdentity item={row} readOnly showId={scenario === 'alignment' ? 'label' : true} />
        ),
      },
      { id: 'quantity', label: '数量', cell: (row) => <QuantityValue quantity={row.quantity} /> },
      {
        id: 'location',
        label: '位置',
        cell: (row) => (
          <LocationPath
            location={row.location}
            state={row.location.id ? 'known' : 'unknown'}
            readOnly
          />
        ),
      },
      {
        id: 'status',
        label: '状态',
        cell: (row) => <ItemStatus status={row.status} recordState={row.recordState} />,
      },
    ],
    [scenario],
  );
  const state =
    scenario === 'loading'
      ? 'loading'
      : scenario === 'error'
        ? 'error'
        : scenario === 'unknown'
          ? 'unknown'
          : 'ready';
  return (
    <div className="vn-stack">
      <ReviewNote>
        独立演示数据集：12 条
        fixture。排序、筛选与分页由此演示控制器处理，生产组件只展示传入的已加载页。
      </ReviewNote>
      <DataTable
        rows={rows}
        columns={columns}
        caption="当前范围内的具体物品"
        sorting={sorting}
        onSortingChange={(value) => {
          setSorting(value);
          setPageIndex(0);
          setMessage(
            `收到排序意图：${value[0] ? `${value[0].id} ${value[0].desc ? '降序' : '升序'}` : '原始顺序'}`,
          );
        }}
        filterValue={query}
        onFilterChange={(value) => {
          setQuery(value);
          setPageIndex(0);
        }}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        getRowLabel={(row) => row.name}
        onOpen={(id) => setMessage(`收到打开意图：${id}`)}
        renderRowDetails={
          scenario === 'alignment'
            ? (row) => (
                <div className="vn-stack">
                  <p className="vn-list-meta">完整物品 ID：{row.id}</p>
                  <p className="vn-list-meta">
                    此物品的补充记录保留原包装批次、存放说明和核对依据。展开时，名称、选择入口、数量、位置和行操作应继续留在原来的摘要位置。
                  </p>
                  <p className="vn-list-meta">
                    长记录示例：物品最初存放在厨房食品柜上层，开封后转移到冷藏区；包装上的日期用途和实际记录的数量依据仍需分别核对，不能把商品规格当作当前剩余数量。
                  </p>
                </div>
              )
            : undefined
        }
        pagination={{
          pageIndex,
          pageSize: 3,
          knownTotal:
            scenario === 'unknown-total' || scenario === 'unknown' ? null : filtered.length,
          hasPrevious: pageIndex > 0,
          hasNext: (pageIndex + 1) * 3 < filtered.length,
        }}
        onPageChange={setPageIndex}
        expandedIds={expandedIds}
        onExpandedChange={setExpandedIds}
        state={state}
        error={
          scenario === 'error' ? '连接中断，当前保留上次已读的页，尚未确认最新结果。' : undefined
        }
        onRetry={() => setMessage('收到重试意图；演示没有发送网络请求。')}
        readOnly={scenario === 'readonly'}
        disabled={scenario === 'disabled'}
        getSelectionAvailability={(row) =>
          scenario === 'unavailable' && row.id === tableItems[0].id
            ? { kind: 'blockedState', reason: '此物品正在另一项处理中。' }
            : scenario === 'error'
              ? { kind: 'offline', reason: '请恢复连接后核对选择。' }
              : available
        }
      />
      <DemoMessage>{message}</DemoMessage>
    </div>
  );
}

export function PaginationControlsDemo({ scenario }: ReviewDemoProps) {
  const [pageIndex, setPageIndex] = useState(scenario === 'last-page' ? 2 : 0);
  useEffect(() => {
    setPageIndex(scenario === 'last-page' ? 2 : 0);
  }, [scenario]);
  const empty = scenario === 'empty';
  return (
    <div className="vn-stack">
      <PaginationControls
        pageIndex={pageIndex}
        pageSize={3}
        loadedCount={empty ? 0 : pageIndex === 2 ? 1 : 3}
        knownTotal={scenario === 'unknown-total' ? null : empty ? 0 : 7}
        hasPrevious={!empty && pageIndex > 0}
        hasNext={!empty && pageIndex < 2}
        onPageChange={setPageIndex}
        loading={scenario === 'loading'}
        disabled={scenario === 'disabled'}
      />
      <ReviewNote>{`演示当前页索引：${pageIndex}。上一页 / 下一页来自提供的可用性；未知总数不显示末页或猜测总页数。`}</ReviewNote>
    </div>
  );
}

export function ItemStatusDemo({ scenario }: ReviewDemoProps) {
  const [message, setMessage] = useState('');
  const facts: ItemStatusFact[] = [
    { kind: 'lifecycle', label: '生命周期', value: scenario === 'unknown' ? null : '持有中' },
    { kind: 'opening', label: '开封', value: scenario === 'unknown' ? null : '已开封' },
    { kind: 'custody', label: '保管', value: null },
    { kind: 'service', label: '维护', value: null },
  ];
  return (
    <div className="vn-stack">
      <ItemStatus
        status={
          scenario === 'unknown'
            ? null
            : {
                label:
                  scenario === 'long-text'
                    ? '正在等待家庭成员确认最近一次使用后的完整状态，当前记录仍保留原事实'
                    : '已开封',
                tone: 'neutral',
              }
        }
        recordState={scenario === 'void' ? 'VOID' : 'VALID'}
        facts={facts}
        loading={scenario === 'loading'}
        availability={
          scenario === 'readonly'
            ? { kind: 'readOnly', reason: '当前账号可以查看状态，不能修改。' }
            : scenario === 'unavailable'
              ? { kind: 'missingFacts', reason: '尚未记录剩余数量，暂时不能消耗。' }
              : available
        }
        onExplain={() =>
          setMessage('已展开说明：生命周期、开封、保管与维护为独立事实；没有记录不代表默认可用。')
        }
      />
      <DemoMessage>{message}</DemoMessage>
    </div>
  );
}

export function PageHeaderDemo({ scenario }: ReviewDemoProps) {
  const [message, setMessage] = useState('');
  const minimal = scenario === 'minimal';
  return (
    <div className="vn-stack">
      <PageHeader
        title={
          scenario === 'long-text' ? '家庭共享储藏空间中待核对的独立物品与完整记录' : '家庭物品'
        }
        headingLevel={2}
        context={scenario === 'long-text' ? '示例家庭 · 当前筛选范围' : undefined}
        onBack={minimal ? undefined : () => setMessage('收到返回物品列表意图。')}
        backLabel="物品列表"
        secondaryActions={
          minimal
            ? []
            : [
                {
                  id: 'scan',
                  label: '扫码',
                  availability:
                    scenario === 'unavailable'
                      ? { kind: 'unsupportedHost', reason: '此设备没有可用的扫码入口。' }
                      : available,
                  onAction: () => setMessage('收到扫码意图。'),
                },
              ]
        }
        primaryAction={
          minimal
            ? undefined
            : {
                id: 'intake',
                label: '添加物品',
                availability:
                  scenario === 'readonly'
                    ? { kind: 'readOnly', reason: '当前家庭为只读访问。' }
                    : available,
                busy: scenario === 'busy',
                onAction: () => setMessage('收到打开入库任务意图；未创建物品。'),
              }
        }
      />
      <DemoMessage>{message}</DemoMessage>
    </div>
  );
}

export function ProductSummaryDemo({ scenario }: ReviewDemoProps) {
  const [message, setMessage] = useState('');
  const current =
    scenario === 'unknown'
      ? null
      : {
          ...group,
          name:
            scenario === 'long-text'
              ? '家庭分享装原味燕麦饮 · 同一商品下不同具体物品的已知事实汇总'
              : group.name,
          locations: scenario === 'multiple-locations' ? 4 : group.locations,
          totals:
            scenario === 'multiple-units'
              ? [
                  { unit: 'mL', value: '310.00', estimated: true, unknownAccuracy: false },
                  { unit: 'L', value: '2.0000', estimated: false, unknownAccuracy: true },
                ]
              : group.totals,
          ...(scenario === 'empty'
            ? {
                count: 0,
                currentCount: 0,
                locations: 0,
                totals: [],
                opened: 0,
                sealed: 0,
                unknownOpening: 0,
                unknownLifecycle: 0,
                unknownQuantity: 0,
                overdueCount: 0,
                lowStock: null,
              }
            : {}),
        };
  return (
    <div className="vn-stack">
      <ProductSummary
        group={current}
        coverage={
          scenario === 'cached' ? 'cached-subset' : scenario === 'unknown' ? 'none' : 'live'
        }
        knownItemCount={scenario === 'unknown-count' ? null : undefined}
        nextDate={scenario === 'empty' ? null : dateFixture}
        loading={scenario === 'loading'}
        error={scenario === 'error' ? '汇总请求未完成，不能判断完整数量。' : undefined}
        onOpenItems={(id) => setMessage(`收到查看此商品下具体物品的意图：${id}`)}
        onIntake={(id) => setMessage(`收到入库任务意图：${id}；未执行写入。`)}
        intakeAvailability={
          scenario === 'readonly'
            ? { kind: 'readOnly', reason: '当前账号不能创建物品。' }
            : available
        }
      />
      <DemoMessage>{message}</DemoMessage>
    </div>
  );
}

function ItemPresentationDemo({ scenario, card }: ReviewDemoProps & { card: boolean }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setSelectedIds(scenario === 'selected' ? [items[0].id] : []);
  }, [scenario]);
  const current: ItemView = {
    ...items[0],
    name:
      scenario === 'long-text'
        ? '家庭共享燕麦饮 · 常温保存原味配方 · 带完整包装规格与购买批次说明的独立物品'
        : items[0].name,
    ...(scenario === 'unknown'
      ? {
          status: { label: '状态未记录', tone: 'neutral' as const },
          location: { id: null, path: [], label: '位置未记录' },
          facts: [],
        }
      : {}),
    redactedPaths: scenario === 'redacted' ? ['display_name'] : [],
  };
  const availability: ActionAvailability =
    scenario === 'unavailable' || scenario === 'unknown'
      ? { kind: 'missingFacts', reason: '剩余数量尚未核对，暂时不能消耗。' }
      : scenario === 'error'
        ? { kind: 'offline', reason: '请恢复连接后处理物品。' }
        : available;
  const common: Omit<ItemRowProps, 'item'> = {
    quantity:
      scenario === 'unknown'
        ? { value: null, unit: 'mL', accuracy: 'unknown' }
        : scenario === 'zero'
          ? { value: '0', unit: 'mL', accuracy: 'measured' }
          : knownQuantity,
    date:
      scenario === 'unknown'
        ? { ...dateFixture, dueOn: null, state: 'UNKNOWN', basis: null }
        : dateFixture,
    onOpen: (id) => setMessage(`收到打开意图：${id}`),
    onSelect: (id, checked) =>
      setSelectedIds((currentIds) =>
        checked
          ? [...new Set([...currentIds, id])]
          : currentIds.filter((currentId) => currentId !== id),
      ),
    onAction: (kind, id) => setMessage(`收到 ${kind} 意图：${id}；未执行写入。`),
    onOpenLocation: (id) => setMessage(`收到打开位置意图：${id}`),
    actions: [
      { kind: 'consume', label: '消耗', availability },
      {
        kind: 'move',
        label: '移动',
        availability: scenario === 'error' ? availability : available,
      },
    ],
    readOnly: scenario === 'readonly',
    loading: scenario === 'loading',
    error: scenario === 'error' ? '最新事实尚未读取，保留上次记录。' : undefined,
  };
  const Component = card ? ItemCard : ItemRow;
  const displayedItems =
    scenario === 'alignment'
      ? Array.from({ length: 4 }, (_, index): ItemView => ({
          ...current,
          id: fixtureId(940 + index),
          name:
            index === 2 ? '家庭共享燕麦饮 · 带完整包装规格与购买批次说明的独立物品' : current.name,
          ...(index === 1
            ? {
                location: { id: null, path: [], label: '位置未记录' },
                facts: [],
                status: { label: '状态未记录', tone: 'neutral' as const },
              }
            : {}),
        }))
      : scenario === 'multiple-locations'
        ? [
            current,
            {
              ...current,
              id: items[1].id,
              location: { id: pantryId, path: ['厨房', '备用食品柜'], label: '备用食品柜' },
            },
          ]
        : [current];
  return (
    <div className="vn-stack">
      <div className={card ? 'vn-lists-demo-card-grid' : 'vn-item-list'}>
        {displayedItems.map((item, index) => (
          <Component
            key={item.id}
            item={item}
            {...common}
            quantity={
              scenario === 'alignment' && index === 1
                ? { value: null, unit: 'mL', accuracy: 'unknown' }
                : common.quantity
            }
            date={
              scenario === 'alignment' && index === 1
                ? { ...dateFixture, dueOn: null, state: 'UNKNOWN', basis: null }
                : common.date
            }
            actions={
              scenario === 'alignment'
                ? index === 3
                  ? []
                  : index === 2
                    ? [{ kind: 'move', label: '核对并移动到备用食品柜', availability: available }]
                    : index === 1
                      ? [{ kind: 'move', label: '移动', availability: available }]
                      : common.actions
                : common.actions
            }
            onSelect={scenario === 'alignment' && index % 2 === 1 ? undefined : common.onSelect}
            onOpenLocation={
              scenario === 'alignment' && index === 3 ? undefined : common.onOpenLocation
            }
            readOnly={common.readOnly || (scenario === 'alignment' && index === 3)}
            selected={selectedIds.includes(item.id)}
          />
        ))}
      </div>
      <DemoMessage>{`${message} 已选 ${selectedIds.length} 件。`}</DemoMessage>
    </div>
  );
}

export function ItemRowDemo(props: ReviewDemoProps) {
  return <ItemPresentationDemo {...props} card={false} />;
}
export function ItemCardDemo(props: ReviewDemoProps) {
  return <ItemPresentationDemo {...props} card />;
}

export function AttentionSummaryDemo({ scenario }: ReviewDemoProps) {
  const [message, setMessage] = useState('尚未打开关注类别。');
  const base: AttentionCategory[] = [
    {
      kind: 'date',
      label: '日期',
      count: 2,
      coverage: 'live',
      description: '临近期限或已逾期的已知日期事实',
    },
    {
      kind: 'quantity',
      label: '数量',
      count: null,
      coverage: 'live',
      description: '数量不足或尚待确认的物品',
    },
    { kind: 'tasks', label: '任务', count: 1, coverage: 'live', description: '需要继续处理的任务' },
  ];
  const categories =
    scenario === 'empty'
      ? []
      : base.map((category): AttentionCategory => ({
          ...category,
          count: scenario === 'zero' ? 0 : scenario === 'unknown' ? null : category.count,
          coverage:
            scenario === 'unknown' ? 'none' : scenario === 'cached' ? 'cached-subset' : 'live',
          description:
            scenario === 'long-text'
              ? '此类别仅反映当前读取范围内已经记录的事实；同一具体物品可能同时存在日期、数量以及待处理任务，不能直接相加成为物品总数。'
              : category.description,
        }));
  return (
    <div className="vn-stack">
      <AttentionSummary
        categories={categories}
        stale={scenario === 'cached'}
        loading={scenario === 'loading'}
        error={scenario === 'error' ? '关注事实读取失败，计数未知。' : undefined}
        disabled={scenario === 'disabled'}
        onOpenCategory={(kind) => setMessage(`收到打开 ${kind} 类别意图。`)}
      />
      <DemoMessage>{message}</DemoMessage>
    </div>
  );
}

function selectionIdsFor(scenario: string): string[] {
  if (scenario === 'empty') return [];
  if (scenario === 'wrong-identity') return [skuId];
  const count =
    scenario === 'limit-100'
      ? 100
      : scenario === 'over-limit-101'
        ? 101
        : scenario === 'hidden-selection'
          ? 3
          : 2;
  return Array.from({ length: count }, (_, seed) => fixtureId(seed + 1));
}

export function BatchSelectionBarDemo({ scenario }: ReviewDemoProps) {
  const [ids, setIds] = useState(() => selectionIdsFor(scenario));
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setIds(selectionIdsFor(scenario));
    setExpanded(
      scenario === 'hidden-selection' ||
        scenario === 'unavailable' ||
        scenario === 'wrong-identity',
    );
  }, [scenario]);
  const snapshot = {
    scope: householdId,
    ids,
    visibleIds: scenario === 'hidden-selection' ? ids.slice(0, 1) : ids.slice(0, 3),
    unavailableIds: scenario === 'unavailable' ? [fixtureId(2)] : [],
    revisions: Object.fromEntries(ids.map((id) => [id, 7])),
    limit: 100,
  };
  return (
    <div className="vn-stack">
      <BatchSelectionBar
        selection={snapshot}
        expanded={expanded}
        onExpandedChange={setExpanded}
        onRemove={(id) => {
          setIds((current) => current.filter((value) => value !== id));
          setMessage(`已从演示选择中移除：${id}`);
        }}
        onClear={() => {
          setIds([]);
          setMessage('已清空演示选择。');
        }}
        onReview={(selection) => {
          setExpanded(true);
          setMessage(`核对 ${selection.ids.length} 个完整物品身份，范围 ${selection.scope}。`);
        }}
        onStartAction={(selection) =>
          setMessage(`收到处理 ${selection.ids.length} 件的意图；不会自动分批或执行写入。`)
        }
        availability={
          scenario === 'offline'
            ? { kind: 'offline', reason: '当前离线，恢复连接并核对选择后才能处理。' }
            : available
        }
        readOnly={scenario === 'readonly'}
        busy={scenario === 'busy'}
      />
      {ids.length === 0 && (
        <Button variant="secondary" onClick={() => setIds(selectionIdsFor('normal'))}>
          选择两件演示物品
        </Button>
      )}
      <DemoMessage>{message}</DemoMessage>
    </div>
  );
}

export const listsEntries: ReviewEntry[] = [
  {
    id: 'data-table',
    name: '数据表格',
    group: '列表与选择',
    description: 'DataTable · TanStack v9 受控服务器页，排序、筛选、选择与分页均通过意图回调。',
    component: DataTableDemo,
    scenarios: dataTableScenarios,
    storyId: 'rc1-lists--data-table',
    limitations: '仅已加载页；演示控制器独立持有 12 条 fixture，不证明服务端分页集成。',
  },
  {
    id: 'pagination-controls',
    name: '分页控制',
    group: '列表与选择',
    description: 'PaginationControls · 区分本页加载数与已知服务器总数，未知时不猜测末页。',
    component: PaginationControlsDemo,
    scenarios: paginationControlsScenarios,
    storyId: 'rc1-lists--pagination-controls',
  },
  {
    id: 'item-status',
    name: '物品状态',
    group: '列表与选择',
    description: 'ItemStatus · 独立维度与明确不可用原因，未记录保持未知。',
    component: ItemStatusDemo,
    scenarios: itemStatusScenarios,
    storyId: 'rc1-lists--item-status',
  },
  {
    id: 'page-header',
    name: '页面标题',
    group: '列表与选择',
    description: 'PageHeader · 响应式标题、上下文、返回与明确操作意图。',
    component: PageHeaderDemo,
    scenarios: pageHeaderScenarios,
    storyId: 'rc1-lists--page-header',
  },
  {
    id: 'product-summary',
    name: '商品汇总',
    group: '列表与选择',
    description: 'ProductSummary · 真实 GroupView、单位合计、未知数量和读取范围；不产生批量授权。',
    component: ProductSummaryDemo,
    scenarios: productSummaryScenarios,
    storyId: 'rc1-lists--product-summary',
  },
  {
    id: 'item-row',
    name: '物品行',
    group: '列表与选择',
    description: 'ItemRow · 完整物品身份与精确事实，打开、选择、操作相互独立。',
    component: ItemRowDemo,
    scenarios: itemRowScenarios,
    storyId: 'rc1-lists--item-row',
  },
  {
    id: 'item-card',
    name: '物品卡片',
    group: '列表与选择',
    description: 'ItemCard · 与物品行复用同一事实和意图契约，卡片呈现。',
    component: ItemCardDemo,
    scenarios: itemRowScenarios,
    storyId: 'rc1-lists--item-card',
  },
  {
    id: 'attention-summary',
    name: '关注汇总',
    group: '列表与选择',
    description: 'AttentionSummary · 日期、数量和任务分别计数，不虚构跨类别去重总数。',
    component: AttentionSummaryDemo,
    scenarios: attentionSummaryScenarios,
    storyId: 'rc1-lists--attention-summary',
  },
  {
    id: 'batch-selection-bar',
    name: '批量选择栏',
    group: '列表与选择',
    description: 'BatchSelectionBar · 具体 UUID、隐藏与不可用选择、完整身份清单及 100 / 101 上限。',
    component: BatchSelectionBarDemo,
    scenarios: batchSelectionBarScenarios,
    storyId: 'rc1-lists--batch-selection-bar',
  },
];
