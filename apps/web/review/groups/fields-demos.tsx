import { ReviewNote, ReviewFeedback } from '../review-frame';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Calendar } from '../../src/ui/components/ui/calendar';
import { DateInput } from '../../src/ui/components/ui/date-input';
import { Button } from '../../src/ui/components/ui/button';
import { SearchBar } from '../../src/ui/patterns/search-bar';
import { FilterBar, type ActiveFilter } from '../../src/ui/patterns/filter-bar';
import { QuantityInput } from '../../src/ui/patterns/quantity-input';
import { DateFactField } from '../../src/ui/patterns/date-fact-field';
import {
  CatalogPicker,
  type CatalogCandidate,
  type CatalogSelection,
} from '../../src/ui/patterns/catalog-picker';
import {
  LocationPicker,
  type LocationCandidate,
  type LocationSelection,
} from '../../src/ui/patterns/location-picker';
import type { DateFactPresentation, QuantityPresentation } from '../../src/ui/patterns/types';
import { catalog, locations } from '../fixtures';
import type { ReviewDemoProps, ReviewEntry, ReviewScenario } from '../types';

// Local fixture drivers only. No business commands or implicit device capability checks.
function useScenario<T>(scenario: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    setValue(initial);
  }, [scenario]);
  return [value, setValue];
}
const s = (id: string, label: string): ReviewScenario => ({ id, label });
const common = [
  s('normal', '正常交互'),
  s('empty', '空值'),
  s('unknown', '未知'),
  s('error', '错误'),
  s('readonly', '只读'),
  s('disabled', '禁用'),
  s('loading', '加载中'),
  s('long-text', '长文本'),
];
const longText = '厨房北侧高柜第二层的节日备用物品收纳区域，供所有家庭成员辨认与共同核对';

export function CalendarDemo({ scenario }: ReviewDemoProps) {
  const [value, setValue] = useScenario<string | null>(
    scenario,
    scenario === 'unknown' || scenario === 'empty'
      ? null
      : scenario === 'error'
        ? '2026-02-29'
        : scenario === 'leap'
          ? '2028-02-29'
          : '2026-11-06',
  );
  const [month, setMonth] = useScenario(
    scenario,
    scenario === 'error' ? '2026-02' : scenario === 'leap' ? '2028-02' : '2026-11',
  );
  const [log, setLog] = useScenario(scenario, '尚未选择新的日期');
  return (
    <div className="vn-stack">
      <Calendar
        value={value}
        onValueChange={(next) => {
          setValue(next);
          setLog(`本地选择：${next ?? '未记录'}`);
        }}
        month={month}
        onMonthChange={setMonth}
        today={scenario === 'unknown' ? null : '2026-11-06'}
        disabled={scenario === 'disabled'}
        readOnly={scenario === 'readonly'}
        min={scenario === 'range' ? '2026-11-03' : undefined}
        max={scenario === 'range' ? '2026-11-18' : undefined}
      />
      <span className="vn-muted" role="status">
        {log}；显示月份：{month}
      </span>
      <span className="vn-muted">日期从本地 fixture 提供；“今天”缺失时不会借用浏览器时区。</span>
    </div>
  );
}

export function DateInputDemo({ scenario }: ReviewDemoProps) {
  const [value, setValue] = useScenario<string | null>(
    scenario,
    ['empty', 'unknown'].includes(scenario)
      ? null
      : scenario === 'error'
        ? '2026-02-29'
        : scenario === 'partial'
          ? '2026-11-'
          : '2026-11-06',
  );
  const [month, setMonth] = useScenario(scenario, scenario === 'error' ? '2026-02' : '2026-11');
  const [log, setLog] = useScenario(scenario, '尚未提交有效的日期草稿');
  return (
    <div className="vn-stack">
      <DateInput
        value={value}
        onValueChange={setValue}
        onCommit={(next) => setLog(`有效日期草稿：${next ?? '清除日期'}（未发送请求）`)}
        month={month}
        onMonthChange={setMonth}
        today="2026-11-06"
        label={scenario === 'long-text' ? '需要多个家庭成员共同核对的物品归还约定日期' : '约定日期'}
        readOnly={scenario === 'readonly'}
        disabled={scenario === 'disabled'}
        hint={scenario === 'unknown' ? '日期尚未记录；清除不会写入默认日期。' : undefined}
      />
      <ReviewFeedback>{log}</ReviewFeedback>
      <span className="vn-muted">当前原文：{value ?? 'null（未记录）'}</span>
    </div>
  );
}

export function SearchBarDemo({ scenario }: ReviewDemoProps) {
  const [value, setValue] = useScenario(
    scenario,
    scenario === 'empty' ? '' : scenario === 'long-text' ? longText : '燕麦饮',
  );
  const [loading, setLoading] = useScenario(scenario, scenario === 'loading');
  const [log, setLog] = useScenario(scenario, '尚未执行搜索意图');
  return (
    <div className="vn-stack">
      <SearchBar
        value={value}
        onChange={setValue}
        onSearch={(query) => setLog(`搜索意图：${query || '空查询'}（仅当前演示范围）`)}
        loading={loading}
        error={scenario === 'error' ? '当前读取失败，请重新搜索。' : undefined}
        readOnly={scenario === 'readonly'}
        disabled={scenario === 'disabled'}
        scanCapability={
          scenario === 'missing-capability'
            ? { available: false, reason: '当前设备不支持编码扫描，请输入名称。' }
            : { available: true }
        }
        onScan={() => setLog('收到扫描意图；此演示未连接相机。')}
      />
      <ReviewFeedback>{log}</ReviewFeedback>
      <span className="vn-muted">可使用中文输入法；组词时按 Enter 不会提交搜索。</span>
      {loading && (
        <Button
          variant="secondary"
          onClick={() => {
            setLoading(false);
            setLog('本地加载状态已解除，未伪造搜索结果。');
          }}
        >
          解除演示加载状态
        </Button>
      )}
    </div>
  );
}

const filterFixtures: readonly ActiveFilter[] = [
  { id: 'scope-household', label: '家庭', valueLabel: '当前家庭', removable: false },
  { id: 'location-kitchen', label: '位置', valueLabel: '厨房' },
  { id: 'record-current', label: '记录', valueLabel: '当前有效' },
];
export function FilterBarDemo({ scenario }: ReviewDemoProps) {
  const [filters, setFilters] = useScenario<readonly ActiveFilter[]>(
    scenario,
    scenario === 'empty'
      ? []
      : scenario === 'unknown'
        ? [{ id: 'quantity-unrecorded', label: '数量', valueLabel: '未记录' }]
        : filterFixtures.map((filter) => ({
            ...filter,
            valueLabel:
              scenario === 'long-text' && filter.id === 'location-kitchen'
                ? longText
                : filter.valueLabel,
          })),
  );
  const [log, setLog] = useScenario(scenario, '尚未修改筛选');
  return (
    <div className="vn-stack">
      <FilterBar
        filters={filters}
        onRemove={(id) => {
          setFilters((current) => current.filter((filter) => filter.id !== id));
          setLog(`已移除本地筛选：${id}`);
        }}
        onClear={() => {
          setFilters((current) => current.filter((filter) => filter.removable === false));
          setLog('已清除可移除条件，固定范围仍保留。');
        }}
        onOpenFilters={() => {
          setFilters((current) => [
            ...current.filter((filter) => filter.id !== 'quantity-unrecorded'),
            { id: 'quantity-unrecorded', label: '数量', valueLabel: '未记录' },
          ]);
          setLog('已加入本地演示筛选：数量未记录');
        }}
        scopeLabel="当前家庭内已读取的范围"
        loading={scenario === 'loading'}
        error={scenario === 'error' ? '按当前条件读取失败；不能将失败解释为没有物品。' : undefined}
        readOnly={scenario === 'readonly'}
        disabled={scenario === 'disabled'}
      />
      <ReviewFeedback>{log}</ReviewFeedback>
    </div>
  );
}

export function QuantityInputDemo({ scenario }: ReviewDemoProps) {
  const initial: QuantityPresentation = {
    value: ['empty', 'unknown', 'mixed'].includes(scenario)
      ? null
      : scenario === 'error'
        ? '12.'
        : scenario === 'precise'
          ? '9007199254740993.000001'
          : '12.500',
    unit: scenario === 'unknown' ? '' : 'mL',
    accuracy: ['empty', 'unknown', 'mixed'].includes(scenario) ? 'unknown' : 'estimated',
  };
  const [value, setValue] = useScenario(scenario, initial);
  const [mixed, setMixed] = useScenario(scenario, scenario === 'mixed');
  const [log, setLog] = useScenario(scenario, '尚未应用数量草稿');
  return (
    <div className="vn-stack">
      <QuantityInput
        value={value}
        onChange={(next, field) => {
          setValue(next);
          if (field === 'value' || field === 'unknown') setMixed(false);
        }}
        onCommit={(next) =>
          setLog(
            `已收到有效本地草稿：${next.value ?? '未记录'} ${next.unit || '单位未记录'} / ${next.accuracy}；未写入库存。`,
          )
        }
        units={[
          { value: 'mL', label: scenario === 'long-text' ? '毫升（按实际液体体积记录）' : 'mL' },
          { value: 'g', label: 'g' },
          { value: 'piece', label: '件' },
        ]}
        minimum={scenario === 'range' ? '0.001' : undefined}
        maximum={scenario === 'range' ? '100.000' : undefined}
        mixed={mixed}
        loading={scenario === 'loading'}
        readOnly={scenario === 'readonly'}
        disabled={scenario === 'disabled'}
        label={scenario === 'long-text' ? '需要保留估计性质和原始小数精度的剩余数量' : '剩余数量'}
      />
      <ReviewFeedback>{log}</ReviewFeedback>
      <ReviewNote>字符串原文：{value.value ?? 'null'}；0 只会来自明确输入。</ReviewNote>
    </div>
  );
}

export function DateFactFieldDemo({ scenario }: ReviewDemoProps) {
  const initial: DateFactPresentation = {
    kind: scenario === 'warranty' ? 'WARRANTY_END' : 'EXPIRY',
    source: scenario === 'warranty' ? 'DEADLINE' : 'LIFECYCLE',
    label: scenario === 'warranty' ? '设备保修结束' : '包装上的期限',
    dateKind:
      scenario === 'unknown' ? null : scenario === 'estimated' ? 'ESTIMATED' : 'BEST_BEFORE',
    dueOn: ['empty', 'unknown'].includes(scenario)
      ? null
      : scenario === 'error'
        ? '2026-02-29'
        : '2026-11-10',
    basis:
      scenario === 'long-text'
        ? `${longText}。包装原始日期需要保留，并与人工补充记录一起核对。`
        : scenario === 'unknown'
          ? null
          : '包装原始标注',
    state: scenario === 'invalid-completion' ? 'COMPLETED' : 'UNKNOWN',
    completedOn: scenario === 'invalid-completion' ? '2026-02-29' : null,
  };
  const [fact, setFact] = useScenario(scenario, initial);
  const [month, setMonth] = useScenario(scenario, scenario === 'error' ? '2026-02' : '2026-11');
  const [log, setLog] = useScenario(scenario, '尚未编辑日期事实');
  return (
    <div className="vn-stack">
      <DateFactField
        fact={fact}
        onChange={(next) => {
          setFact(next);
          setLog(
            `本地草稿：${next.kind} / ${next.dateKind ?? '未记录口径'} / ${next.dueOn ?? '日期未记录'}`,
          );
        }}
        timezone={scenario === 'missing-capability' ? null : 'Asia/Shanghai'}
        month={month}
        onMonthChange={setMonth}
        today="2026-11-06"
        loading={scenario === 'loading'}
        readOnly={scenario === 'readonly'}
        disabled={scenario === 'disabled'}
      />
      <ReviewFeedback>{log}</ReviewFeedback>
      <ReviewNote>示例不派生到期状态；kind / source / state 由上游事实保留。</ReviewNote>
    </div>
  );
}

const catalogCandidates: readonly CatalogCandidate[] = [
  ...catalog.map((node) => ({
    id: node.id,
    kind: node.kind,
    name: node.name,
    path: node.kind === 'GROUP' ? [node.name] : ['食品', '饮品', node.name],
    ruleSummary: node.kind === 'GROUP' ? '用于商品归类' : '按独立物品记录数量',
  })),
  {
    id: 'catalog_node_00000000-0000-4000-8000-000000000031',
    kind: 'SKU',
    name: '燕麦饮 · 原味',
    path: ['家庭备用', '常温饮品', '燕麦饮 · 原味'],
    ruleSummary: '同名但独立的目录节点',
  },
  {
    id: 'catalog_node_00000000-0000-4000-8000-000000000032',
    kind: 'SKU',
    name: '已停用商品',
    path: ['食品', '历史目录', '已停用商品'],
    disabledReason: '该商品目录已停用。',
  },
];
export function CatalogPickerDemo({ scenario }: ReviewDemoProps) {
  const [value, setValue] = useScenario<CatalogSelection>(
    scenario,
    scenario === 'unknown' || scenario === 'empty' ? null : catalogCandidates[1],
  );
  const [query, setQuery] = useScenario(scenario, scenario === 'empty' ? '未匹配的演示名称' : '');
  const [log, setLog] = useScenario(scenario, '尚未选择新目录节点');
  const [resolved, setResolved] = useScenario(scenario, false);
  const loading = scenario === 'loading' && !resolved;
  const error = scenario === 'error' && !resolved;
  const candidatePage =
    scenario === 'long-text'
      ? catalogCandidates.map((candidate) => ({
          ...candidate,
          path: [...candidate.path, longText],
        }))
      : catalogCandidates;
  const selectedLabel = value?.name === query;
  const candidates =
    loading || error
      ? []
      : candidatePage.filter(
          (candidate) =>
            !query ||
            selectedLabel ||
            `${candidate.name} ${candidate.path.join(' ')}`.includes(query),
        );
  return (
    <div className="vn-stack">
      <CatalogPicker
        value={value}
        onValueChange={(next) => {
          setValue(next);
          setLog(next ? `已选择 ${next.kind}：${next.id}` : '已清除目录选择');
        }}
        candidates={candidates}
        allowedKinds={scenario === 'sku-only' ? ['SKU'] : ['GROUP', 'SKU']}
        query={query}
        onQueryChange={setQuery}
        onRequestCreate={(kind, text) =>
          setLog(`新建意图：${kind} / ${text || '空名称'}；未创建节点。`)
        }
        createUnavailableReason={
          scenario === 'missing-capability'
            ? '当前身份无法新建目录节点，可选择已有节点。'
            : undefined
        }
        loading={loading}
        error={error ? '目录候选暂时读取失败。' : undefined}
        readOnly={scenario === 'readonly'}
        disabled={scenario === 'disabled'}
      />
      {(loading || error) && (
        <Button variant="secondary" onClick={() => setResolved(true)}>
          载入本地候选页
        </Button>
      )}
      <ReviewFeedback>{log}</ReviewFeedback>
      <ReviewNote>搜索只过滤当前示例候选。</ReviewNote>
    </div>
  );
}

const locationCandidates: readonly LocationCandidate[] = [
  {
    itemId: locations[1].id,
    name: locations[1].name,
    path: ['厨房', '冰箱'],
    eligibility: { kind: 'validContainer' },
    source: '位置能力校验',
  },
  {
    itemId: 'item_00000000-0000-4000-8000-000000000021',
    name: '备用收纳盒',
    path: ['储藏间', '层架', '备用收纳盒'],
    eligibility: { kind: 'validContainer' },
    source: '位置能力校验',
  },
  {
    itemId: 'item_00000000-0000-4000-8000-000000000022',
    name: '当前上级容器',
    path: ['厨房', '高柜'],
    eligibility: { kind: 'currentParent', reason: '已经位于此处，无需再次移动。' },
    source: '当前存放关系',
  },
  {
    itemId: 'item_00000000-0000-4000-8000-000000000023',
    name: '内部小盒',
    path: ['当前物品', '内部小盒'],
    eligibility: { kind: 'cycle', reason: '选择后会形成循环存放关系。' },
    source: '存放关系校验',
  },
  {
    itemId: 'item_00000000-0000-4000-8000-000000000024',
    name: '收纳盒图案杯子',
    path: ['厨房', '餐具架', '杯子'],
    eligibility: { kind: 'invalid', reason: '该物品不具备容纳物品的能力。' },
    source: '物品能力',
  },
  {
    itemId: 'item_00000000-0000-4000-8000-000000000025',
    name: '尚未确认的箱子',
    path: ['储藏间', '未检查区域', '箱子'],
    eligibility: { kind: 'unverified', reason: '容器能力尚未确认。' },
    source: '待核对记录',
  },
];
export function LocationPickerDemo({ scenario }: ReviewDemoProps) {
  const [value, setValue] = useScenario<LocationSelection>(
    scenario,
    scenario === 'unknown' || scenario === 'empty'
      ? { kind: 'unknown' }
      : scenario === 'root'
        ? { kind: 'root' }
        : {
            kind: 'item',
            itemId: locationCandidates[0].itemId,
            name: locationCandidates[0].name,
            path: locationCandidates[0].path,
          },
  );
  const [query, setQuery] = useScenario(scenario, scenario === 'empty' ? '未匹配的位置' : '');
  const [resolved, setResolved] = useScenario(scenario, false);
  const [log, setLog] = useScenario(scenario, '尚未选择新位置');
  const loading = scenario === 'loading' && !resolved;
  const error = scenario === 'error' && !resolved;
  const candidatePage =
    scenario === 'long-text'
      ? locationCandidates.map((candidate) => ({
          ...candidate,
          path: [...candidate.path, longText],
        }))
      : locationCandidates;
  const candidates =
    loading || error
      ? []
      : candidatePage.filter(
          (candidate) =>
            !query ||
            (value.kind === 'item' && value.name === query) ||
            `${candidate.name} ${candidate.path.join(' ')}`.includes(query),
        );
  return (
    <div className="vn-stack">
      <LocationPicker
        value={value}
        onValueChange={(next) => {
          setValue(next);
          if (next.kind !== 'item') setQuery('');
          setLog(
            next.kind === 'item'
              ? `位置选择意图：${next.itemId}`
              : next.kind === 'root'
                ? '明确选择家庭根位置'
                : '明确标记位置未知',
          );
        }}
        candidates={candidates}
        query={query}
        onQueryChange={setQuery}
        rootPolicy={{
          allowed: scenario !== 'missing-capability',
          reason: '当前移动操作要求选择明确容器。',
        }}
        unknownPolicy={{
          allowed: scenario !== 'missing-capability',
          reason: '当前操作不允许将位置改为未知。',
        }}
        loading={loading}
        error={error ? '位置候选读取失败；原选择保持不变。' : undefined}
        disabled={scenario === 'disabled'}
        readOnly={scenario === 'readonly'}
      />
      {(loading || error) && (
        <Button variant="secondary" onClick={() => setResolved(true)}>
          载入本地候选页
        </Button>
      )}
      <ReviewFeedback>{log}</ReviewFeedback>
      <span className="vn-muted">候选的容器有效性、循环关系及禁用原因由 fixture 明确提供。</span>
    </div>
  );
}

export const fieldsEntries: ReviewEntry[] = [
  {
    id: 'calendar',
    name: '日历',
    group: '领域输入',
    description: 'Calendar：受控纯日期、中文月份、方向键与明确日期范围。',
    component: CalendarDemo,
    scenarios: [
      s('normal', '选择日期'),
      s('unknown', '未选择且今日未知'),
      s('error', '无效闰日'),
      s('leap', '有效闰日'),
      s('range', '日期范围'),
      s('readonly', '只读'),
      s('disabled', '禁用'),
    ],
    storyId: 'rc1-fields--calendar',
    limitations: '日期展示桥接 DayPicker；业务日期不经过 UTC 转换。',
  },
  {
    id: 'date-input',
    name: '日期输入',
    group: '领域输入',
    description: 'DateInput：直接输入与日历选择，保留无效及未完成原文。',
    component: DateInputDemo,
    scenarios: [...common.filter((entry) => entry.id !== 'loading'), s('partial', '未完成日期')],
    storyId: 'rc1-fields--date-input',
  },
  {
    id: 'search-bar',
    name: '搜索栏',
    group: '领域输入',
    description: 'SearchBar：受控查询、中文输入法提交守卫和扫描能力边界。',
    component: SearchBarDemo,
    scenarios: [
      ...common.filter((entry) => entry.id !== 'unknown'),
      s('missing-capability', '扫描不可用'),
    ],
    storyId: 'rc1-fields--search-bar',
  },
  {
    id: 'filter-bar',
    name: '筛选栏',
    group: '领域输入',
    description: 'FilterBar：明确显示筛选、单项移除和保留固定范围。',
    component: FilterBarDemo,
    scenarios: common,
    storyId: 'rc1-fields--filter-bar',
  },
  {
    id: 'quantity-input',
    name: '数量输入',
    group: '领域输入',
    description: 'QuantityInput：十进制字符串、单位和依据分离，未知不等于零。',
    component: QuantityInputDemo,
    scenarios: [
      ...common,
      s('mixed', '多个不同值'),
      s('precise', '超出浮点安全精度'),
      s('range', '数量上下限'),
    ],
    storyId: 'rc1-fields--quantity-input',
  },
  {
    id: 'date-fact-field',
    name: '日期事实字段',
    group: '领域输入',
    description: 'DateFactField：保留日期用途、日期口径、来源、依据及上游状态。',
    component: DateFactFieldDemo,
    scenarios: [
      ...common,
      s('estimated', '估计日期'),
      s('warranty', '保修用途'),
      s('invalid-completion', '完成日期错误'),
      s('missing-capability', '家庭时区未设置'),
    ],
    storyId: 'rc1-fields--date-fact-field',
    limitations: '编辑日期不派生到期状态；时区和状态由调用方提供。',
  },
  {
    id: 'catalog-picker',
    name: '目录选择器',
    group: '领域输入',
    description: 'CatalogPicker：区分 GROUP/SKU，显示完整路径和同名节点。',
    component: CatalogPickerDemo,
    scenarios: [...common, s('sku-only', '仅允许商品'), s('missing-capability', '无法新建目录')],
    storyId: 'rc1-fields--catalog-picker',
    limitations: '仅展示外部候选页；创建只发出意图，不合并同名节点。',
  },
  {
    id: 'location-picker',
    name: '位置选择器',
    group: '领域输入',
    description: 'LocationPicker：有效容器、循环禁用、根位置和未知策略。',
    component: LocationPickerDemo,
    scenarios: [...common, s('root', '家庭根位置'), s('missing-capability', '位置策略限制')],
    storyId: 'rc1-fields--location-picker',
    limitations: '容器有效性必须由调用方确认；不凭名称判断或读取全部物品。',
  },
];
