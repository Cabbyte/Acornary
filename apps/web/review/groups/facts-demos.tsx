import { useEffect, useState } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../src/ui/components/ui/table';
import { TreeView, type TreeViewNode } from '../../src/ui/components/ui/tree-view';
import { Separator } from '../../src/ui/components/ui/separator';
import { ItemIdentity } from '../../src/ui/patterns/item-identity';
import { QuantityValue } from '../../src/ui/patterns/quantity-value';
import { DateFactValue } from '../../src/ui/patterns/date-fact-value';
import { LocationPath } from '../../src/ui/patterns/location-path';
import { FactSource } from '../../src/ui/patterns/fact-source';
import type {
  DateFactPresentation,
  FactSourceView,
  ItemView,
  QuantityPresentation,
} from '../../src/ui/patterns/types';
import type { ReviewDemoProps, ReviewEntry, ReviewScenario } from '../types';

// Review-only data. These IDs intentionally retain complete entity identities.
const itemA = 'item_5e391e2b-1bb8-48e5-b299-d6f6c4c15601';
const itemB = 'item_70fb50f3-4fe8-4f11-8f4b-f502a95a3d02';
const roomId = 'item_498572e8-5f48-4568-9f70-beb2b75eb303';
const cabinetId = 'item_abc12345-8daa-4f67-88ff-f628694ecd04';
const drawerId = 'item_d45e48a7-f38f-46c9-9c75-5c91f7d78405';
const spareId = 'item_678109af-f1b4-451b-a6cc-7bb1421c2e06';
const sourceFixture: FactSourceView = {
  templateId: 'attribute_template_0a8a361b-cb3f-4211-9499-268d2582b707',
  path: 'quantity.remaining',
  version: 3,
};
const itemFixture: Pick<ItemView, 'id' | 'name' | 'subtitle' | 'recordState'> = {
  id: itemA,
  name: '燕麦饮',
  subtitle: '无糖 · 1 L 包装',
  recordState: 'VALID',
};
const knownLocation: ItemView['location'] = {
  id: drawerId,
  path: ['厨房', '食品储物柜', '第二层抽屉'],
  label: '第二层抽屉',
};
const treeFixture: readonly TreeViewNode[] = [
  {
    id: roomId,
    label: '厨房',
    children: [
      {
        id: cabinetId,
        label: '食品储物柜',
        children: [{ id: drawerId, label: '第二层抽屉', description: '容纳 3 件物品' }],
      },
      { id: spareId, label: '清洁用品柜', disabled: true, description: '当前不能选择此位置' },
    ],
  },
  { id: itemB, label: '书房', description: '未展开的位置' },
];
const dateFixture: DateFactPresentation = {
  kind: 'EXPIRY',
  dateKind: 'BEST_BEFORE',
  dueOn: '2026-12-08',
  basis: '包装标签',
  state: 'UPCOMING',
  source: 'LIFECYCLE',
  label: '未开封最佳赏味期',
  completedOn: null,
};

export const tableScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '正常 / 排序与打开' },
  { id: 'selected', label: '独立选择' },
  { id: 'loading', label: '加载中' },
  { id: 'empty', label: '空表格' },
  { id: 'error', label: '读取错误' },
  { id: 'long-text', label: '长文本' },
];
export const treeViewScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '展开 / 键盘 / 选择' },
  { id: 'empty', label: '空层级' },
  { id: 'loading', label: '加载中' },
  { id: 'error', label: '错误 / 重试意图' },
  { id: 'disabled', label: '禁用' },
  { id: 'readonly', label: '只读选择' },
  { id: 'long-text', label: '长层级名称' },
];
export const separatorScenarios: readonly ReviewScenario[] = [
  { id: 'horizontal', label: '水平语义分隔' },
  { id: 'vertical', label: '垂直分隔' },
  { id: 'decorative', label: '装饰分隔' },
];
export const itemIdentityScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '正常 / 身份意图' },
  { id: 'long-text', label: '长名称 / 完整 ID' },
  { id: 'unnamed', label: '未命名' },
  { id: 'void', label: '作废记录' },
  { id: 'redacted', label: '名称不可见' },
  { id: 'disabled', label: '禁用' },
  { id: 'readonly', label: '只读' },
  { id: 'loading', label: '加载中' },
];
export const quantityValueScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '已知数量' },
  { id: 'zero', label: '明确为零' },
  { id: 'unknown', label: '数量未知' },
  { id: 'estimated', label: '估计数量' },
  { id: 'unknown-accuracy', label: '精度未知' },
  { id: 'precision', label: '高精度 decimal 字符串' },
  { id: 'invalid', label: '无效输入' },
  { id: 'redacted', label: '不可见' },
  { id: 'loading', label: '加载中' },
];
export const dateFactValueScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '最佳赏味期' },
  { id: 'use-by', label: '限用日期' },
  { id: 'estimated', label: '估计日期' },
  { id: 'warranty', label: '保修结束' },
  { id: 'service', label: '保养日期' },
  { id: 'return', label: '归还期限' },
  { id: 'renewal', label: '续期日期' },
  { id: 'reorder', label: '补货日期' },
  { id: 'unknown', label: '未知' },
  { id: 'due', label: '已到期' },
  { id: 'overdue', label: '已逾期' },
  { id: 'completed', label: '已完成' },
  { id: 'invalid', label: '无效纯日期' },
  { id: 'long-text', label: '长依据' },
  { id: 'redacted', label: '不可见' },
  { id: 'loading', label: '加载中' },
];
export const locationPathScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '完整位置路径' },
  { id: 'root', label: '明确位于根位置' },
  { id: 'unknown', label: '未知位置' },
  { id: 'long-text', label: '长路径 / 同名层级' },
  { id: 'redacted', label: '不可见' },
  { id: 'disabled', label: '禁用打开' },
  { id: 'readonly', label: '只读路径' },
  { id: 'loading', label: '加载中' },
];
export const factSourceScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '模板与字段来源' },
  { id: 'old-version', label: '历史版本' },
  { id: 'unknown', label: '未知来源' },
  { id: 'unavailable', label: '来源不可用' },
  { id: 'long-text', label: '长模板与路径' },
  { id: 'redacted', label: '不可见' },
  { id: 'disabled', label: '禁用查看' },
  { id: 'loading', label: '加载中' },
];

export function TableDemo({ scenario }: ReviewDemoProps) {
  const [sort, setSort] = useState<'ascending' | 'descending'>('ascending');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [event, setEvent] = useState('尚未触发操作');
  useEffect(() => {
    setSelectedIds(scenario === 'selected' ? [itemA] : []);
    setEvent('尚未触发操作');
  }, [scenario]);
  const rows = [
    {
      ...itemFixture,
      quantity: { value: '0.7500', unit: 'L', accuracy: 'measured' } as QuantityPresentation,
    },
    {
      ...itemFixture,
      id: itemB,
      name:
        scenario === 'long-text'
          ? '同一商品的另一件独立物品 · 厨房常温储存区域内尚未开封的家庭分享装燕麦饮'
          : '另一件燕麦饮',
      quantity: { value: null, unit: 'L', accuracy: 'unknown' } as QuantityPresentation,
    },
  ].sort((a, b) =>
    sort === 'ascending' ? a.name.localeCompare(b.name, 'zh') : b.name.localeCompare(a.name, 'zh'),
  );
  const body =
    scenario === 'loading'
      ? '正在加载当前页…'
      : scenario === 'empty'
        ? '当前范围没有物品'
        : scenario === 'error'
          ? '当前页读取失败，数量未知'
          : null;
  return (
    <div className="vn-stack">
      <Table aria-busy={scenario === 'loading' || undefined}>
        <TableCaption>两件独立物品 · 点击列头排序，选择框与打开动作相互独立</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>选择</TableHead>
            <TableHead aria-sort={sort}>
              <BaseButton
                type="button"
                className="vn-fact-link"
                disabled={Boolean(body)}
                onClick={() => setSort(sort === 'ascending' ? 'descending' : 'ascending')}
              >
                物品 {sort === 'ascending' ? '↑' : '↓'}
              </BaseButton>
            </TableHead>
            <TableHead>数量</TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {body ? (
            <TableRow>
              <TableCell colSpan={4}>
                <span role={scenario === 'error' ? 'alert' : 'status'}>{body}</span>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={selectedIds.includes(row.id) ? 'selected' : undefined}
              >
                <TableCell>
                  <label className="vn-facts-demo-checkbox">
                    <input
                      type="checkbox"
                      aria-label={`选择${row.name}，ID ${row.id}`}
                      checked={selectedIds.includes(row.id)}
                      onChange={(e) =>
                        setSelectedIds(
                          e.target.checked
                            ? [...selectedIds, row.id]
                            : selectedIds.filter((id) => id !== row.id),
                        )
                      }
                    />
                  </label>
                </TableCell>
                <TableCell>
                  <ItemIdentity item={row} readOnly />
                </TableCell>
                <TableCell>
                  <QuantityValue quantity={row.quantity} />
                </TableCell>
                <TableCell>
                  <BaseButton
                    type="button"
                    className="vn-fact-button"
                    onClick={() => setEvent(`收到打开意图：${row.id}`)}
                  >
                    打开
                  </BaseButton>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <p className="vn-fact-meta" role="status">
        已选 {selectedIds.length} 件。{event}
      </p>
    </div>
  );
}

export function TreeViewDemo({ scenario }: ReviewDemoProps) {
  const [selectedId, setSelectedId] = useState<string | null>(drawerId);
  const [expandedIds, setExpandedIds] = useState<string[]>([roomId, cabinetId]);
  const [retryCount, setRetryCount] = useState(0);
  const nodes =
    scenario === 'empty' || scenario === 'loading' || scenario === 'error'
      ? []
      : scenario === 'long-text'
        ? [
            {
              ...treeFixture[0],
              label: '厨房 · 存放不需要冷藏食品及日用品的完整位置层级（长名称）',
            },
            treeFixture[1],
          ]
        : treeFixture;
  return (
    <div className="vn-stack">
      <TreeView
        label="存放位置"
        nodes={nodes}
        selectedId={selectedId}
        expandedIds={expandedIds}
        onSelectionChange={setSelectedId}
        onExpandedChange={setExpandedIds}
        disabled={scenario === 'disabled'}
        readOnly={scenario === 'readonly'}
        loading={scenario === 'loading'}
        error={scenario === 'error' ? '位置层级读取失败，尚未获得完整路径。' : undefined}
        onRetry={() => setRetryCount((count) => count + 1)}
      />
      <p className="vn-fact-meta">
        方向键移动或展开；Home / End 跳到首尾；Enter / 空格选择。只读时仍可展开查看。
      </p>
      <p className="vn-fact-meta" role="status">
        当前选择：{selectedId ?? '未选择'} · 展开 {expandedIds.length} 个节点
        {scenario === 'error' ? ` · 已发出 ${retryCount} 次重试意图` : ''}
      </p>
    </div>
  );
}

export function SeparatorDemo({ scenario }: ReviewDemoProps) {
  const [vertical, setVertical] = useState(scenario === 'vertical');
  useEffect(() => {
    setVertical(scenario === 'vertical');
  }, [scenario]);
  return (
    <div className="vn-stack">
      <div className={vertical ? 'vn-row vn-facts-demo-panel' : 'vn-stack vn-facts-demo-panel'}>
        <span>物品事实</span>
        <Separator
          orientation={vertical ? 'vertical' : 'horizontal'}
          decorative={scenario === 'decorative'}
        />
        <span>来源信息</span>
      </div>
      <BaseButton type="button" className="vn-fact-button" onClick={() => setVertical(!vertical)}>
        切换为{vertical ? '水平' : '垂直'}分隔
      </BaseButton>
      <p className="vn-fact-meta">
        {scenario === 'decorative'
          ? '此分隔仅装饰，对辅助技术隐藏。'
          : '此分隔具有 separator 语义。'}
      </p>
    </div>
  );
}

export function ItemIdentityDemo({ scenario }: ReviewDemoProps) {
  const [event, setEvent] = useState('打开和复制均由宿主通过回调处理。');
  const item = {
    ...itemFixture,
    name:
      scenario === 'long-text'
        ? '家庭共享燕麦饮 · 无糖常温保存配方 · 独立编号的具体物品（请核对完整身份）'
        : scenario === 'unnamed'
          ? ''
          : itemFixture.name,
    recordState: scenario === 'void' ? ('VOID' as const) : ('VALID' as const),
  };
  return (
    <div className="vn-stack">
      <ItemIdentity
        item={item}
        disabled={scenario === 'disabled'}
        readOnly={scenario === 'readonly'}
        redacted={scenario === 'redacted'}
        loading={scenario === 'loading'}
        onOpen={(id) => setEvent(`收到打开意图：${id}`)}
        onCopyId={(id) => setEvent(`收到复制意图，尚未调用剪贴板：${id}`)}
      />
      <p className="vn-fact-meta" role="status">
        {event}
      </p>
    </div>
  );
}

function quantityFor(scenario: string): QuantityPresentation {
  if (scenario === 'zero') return { value: '0', unit: 'L', accuracy: 'measured' };
  if (scenario === 'unknown') return { value: null, unit: 'L', accuracy: 'unknown' };
  if (scenario === 'estimated') return { value: '0.75', unit: 'L', accuracy: 'estimated' };
  if (scenario === 'unknown-accuracy') return { value: '0.75', unit: 'L', accuracy: 'unknown' };
  if (scenario === 'precision')
    return { value: '12345678901234567890.12345678901234567890', unit: 'g', accuracy: 'measured' };
  if (scenario === 'invalid') return { value: '1e5', unit: 'g', accuracy: 'measured' };
  return { value: '0.7500', unit: 'L', accuracy: 'measured' };
}

export function QuantityValueDemo({ scenario }: ReviewDemoProps) {
  const [variant, setVariant] = useState(scenario);
  useEffect(() => {
    setVariant(scenario);
  }, [scenario]);
  return (
    <div className="vn-stack">
      <QuantityValue
        quantity={quantityFor(variant)}
        redacted={variant === 'redacted'}
        loading={variant === 'loading'}
      />
      <label className="vn-row">
        显示事实
        <select
          className="vn-facts-demo-select"
          value={variant}
          onChange={(e) => setVariant(e.target.value)}
        >
          {quantityValueScenarios.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="vn-fact-meta">保留原始 decimal 字符串；未知数量和明确为零分别展示。</p>
    </div>
  );
}

function dateFor(scenario: string): DateFactPresentation {
  const fact = { ...dateFixture };
  const kinds: Record<string, DateFactPresentation['kind']> = {
    warranty: 'WARRANTY_END',
    service: 'SERVICE_DUE',
    return: 'RETURN_BY',
    renewal: 'RENEWAL',
    reorder: 'REORDER_BY',
  };
  if (kinds[scenario])
    return {
      ...fact,
      kind: kinds[scenario],
      dateKind: null,
      source: 'DEADLINE',
      label: '',
      basis: '用户明确记录',
    };
  if (scenario === 'use-by') return { ...fact, dateKind: 'USE_BY', label: '包装限用日期' };
  if (scenario === 'estimated')
    return {
      ...fact,
      dateKind: 'ESTIMATED',
      label: '开封后估计期限',
      basis: '开封日期 + 模板保存天数',
    };
  if (scenario === 'unknown')
    return { ...fact, dueOn: null, basis: null, state: 'UNKNOWN', label: '' };
  if (scenario === 'due') return { ...fact, state: 'DUE' };
  if (scenario === 'overdue') return { ...fact, state: 'OVERDUE', dueOn: '2026-10-01' };
  if (scenario === 'completed')
    return {
      ...fact,
      kind: 'SERVICE_DUE',
      dateKind: null,
      source: 'DEADLINE',
      state: 'COMPLETED',
      completedOn: '2026-11-05',
      label: '更换净水滤芯',
    };
  if (scenario === 'invalid') return { ...fact, dueOn: '2026-02-30' };
  if (scenario === 'long-text')
    return {
      ...fact,
      basis:
        '来自家庭管理员按包装侧面的中文标签手工记录，并结合开封时间及储存条件明确确认的日期依据；不由组件推断或重新计算。',
    };
  return fact;
}

export function DateFactValueDemo({ scenario }: ReviewDemoProps) {
  const [variant, setVariant] = useState(scenario);
  useEffect(() => {
    setVariant(scenario);
  }, [scenario]);
  return (
    <div className="vn-stack">
      <DateFactValue
        fact={dateFor(variant)}
        redacted={variant === 'redacted'}
        loading={variant === 'loading'}
      />
      <label className="vn-row">
        日期事实
        <select
          className="vn-facts-demo-select"
          value={variant}
          onChange={(e) => setVariant(e.target.value)}
        >
          {dateFactValueScenarios.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="vn-fact-meta">到期状态由输入提供；YYYY-MM-DD 保留原日期，不转换时区。</p>
    </div>
  );
}

export function LocationPathDemo({ scenario }: ReviewDemoProps) {
  const [event, setEvent] = useState('仅末级位置具有可验证的完整 Item ID，祖先标签不虚构链接。');
  const location =
    scenario === 'unknown' || scenario === 'root'
      ? null
      : scenario === 'long-text'
        ? {
            ...knownLocation,
            path: [
              '家',
              '厨房与餐厅之间的家庭储藏空间',
              '储物柜',
              '储物柜',
              '最下层用于保存备用日用品的透明收纳盒',
            ],
          }
        : knownLocation;
  const state =
    scenario === 'root'
      ? 'root'
      : scenario === 'unknown'
        ? 'unknown'
        : scenario === 'redacted'
          ? 'redacted'
          : 'known';
  return (
    <div className="vn-stack">
      <LocationPath
        location={location}
        state={state}
        disabled={scenario === 'disabled'}
        readOnly={scenario === 'readonly'}
        loading={scenario === 'loading'}
        onOpen={(id) => setEvent(`收到打开位置意图：${id}`)}
      />
      <p className="vn-fact-meta" role="status">
        {event}
      </p>
    </div>
  );
}

export function FactSourceDemo({ scenario }: ReviewDemoProps) {
  const [event, setEvent] = useState('尚未请求查看来源');
  const source =
    scenario === 'unknown'
      ? null
      : scenario === 'old-version'
        ? { ...sourceFixture, version: 1 }
        : scenario === 'long-text'
          ? {
              ...sourceFixture,
              path: 'attributes.household_storage.conditions.refrigeration_after_opening.remaining_quantity',
            }
          : sourceFixture;
  return (
    <div className="vn-stack">
      <FactSource
        source={source}
        templateName={
          scenario === 'long-text'
            ? '家庭常温饮品与开封后冷藏保存规则属性模板 · 历史来源可追溯'
            : '饮品数量模板'
        }
        disabled={scenario === 'disabled'}
        redacted={scenario === 'redacted'}
        loading={scenario === 'loading'}
        unavailableReason={
          scenario === 'unavailable' ? '当前账号不能读取此模板的历史版本。' : undefined
        }
        onInspect={(value) =>
          setEvent(
            `收到查看来源意图：${value.templateId}，版本 ${value.version}，字段 ${value.path}`,
          )
        }
      />
      <p className="vn-fact-meta" role="status">
        {event}
      </p>
      {scenario === 'old-version' && (
        <p className="vn-fact-meta">事实仍指向原版本，不自动改用最新版。</p>
      )}
    </div>
  );
}

export const factsEntries: ReviewEntry[] = [
  {
    id: 'table',
    storyId: 'rc1-facts--table',
    name: '表格',
    group: '事实与结构',
    description: 'Table · 语义表格原语，caption / 列头 / aria-sort，排序与选择由外部控制。',
    component: TableDemo,
    scenarios: tableScenarios,
  },
  {
    id: 'tree-view',
    storyId: 'rc1-facts--tree-view',
    name: '层级树',
    group: '事实与结构',
    description: 'TreeView · 受控单选与展开，完整 ID、方向键、Home / End 和独立焦点。',
    component: TreeViewDemo,
    scenarios: treeViewScenarios,
  },
  {
    id: 'separator',
    storyId: 'rc1-facts--separator',
    name: '分隔线',
    group: '事实与结构',
    description: 'Separator · Base UI 水平、垂直及装饰分隔。',
    component: SeparatorDemo,
    scenarios: separatorScenarios,
  },
  {
    id: 'item-identity',
    storyId: 'rc1-facts--item-identity',
    name: '物品身份',
    group: '事实与结构',
    description: 'ItemIdentity · 保留完整物品 ID，打开与复制通过意图回调处理。',
    component: ItemIdentityDemo,
    scenarios: itemIdentityScenarios,
  },
  {
    id: 'quantity-value',
    storyId: 'rc1-facts--quantity-value',
    name: '数量事实',
    group: '事实与结构',
    description: 'QuantityValue · decimal 字符串、单位、估计与未知，未知不等于零。',
    component: QuantityValueDemo,
    scenarios: quantityValueScenarios,
  },
  {
    id: 'date-fact-value',
    storyId: 'rc1-facts--date-fact-value',
    name: '日期事实',
    group: '事实与结构',
    description: 'DateFactValue · 日期目的、日期类型、依据与状态分别展示，纯日期不换时区。',
    component: DateFactValueDemo,
    scenarios: dateFactValueScenarios,
  },
  {
    id: 'location-path',
    storyId: 'rc1-facts--location-path',
    name: '位置路径',
    group: '事实与结构',
    description: 'LocationPath · 具体物品的存放位置，明确区分根位置、未知与不可见。',
    component: LocationPathDemo,
    scenarios: locationPathScenarios,
  },
  {
    id: 'fact-source',
    storyId: 'rc1-facts--fact-source',
    name: '事实来源',
    group: '事实与结构',
    description: 'FactSource · 保留模板 ID、字段路径与原版本；来源不足时明确说明。',
    component: FactSourceDemo,
    scenarios: factSourceScenarios,
  },
];
