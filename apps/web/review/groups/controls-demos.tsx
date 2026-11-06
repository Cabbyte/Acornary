import { ReviewNote, ReviewFeedback } from '../review-frame';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Search, X, Plus } from 'lucide-react';
import { Button } from '../../src/ui/components/ui/button';
import { IconButton } from '../../src/ui/components/ui/icon-button';
import { Input } from '../../src/ui/components/ui/input';
import { Textarea } from '../../src/ui/components/ui/textarea';
import { FormField } from '../../src/ui/components/ui/form-field';
import { Badge } from '../../src/ui/components/ui/badge';
import { Checkbox } from '../../src/ui/components/ui/checkbox';
import { RadioGroup } from '../../src/ui/components/ui/radio-group';
import { Switch } from '../../src/ui/components/ui/switch';
import { Select, type SelectOption } from '../../src/ui/components/ui/select';
import { Combobox } from '../../src/ui/components/ui/combobox';
import { Tabs } from '../../src/ui/components/ui/tabs';
import type { ReviewDemoProps, ReviewEntry, ReviewScenario } from '../types';

// Fixture-only state and candidate data. No network, persistence, or domain writes.
function useScenarioState<T>(scenario: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    setValue(initial);
  }, [scenario]);
  return [value, setValue];
}
const longLabel = '存放于厨房北侧高柜第二层的家庭共用备用物品，需要保留完整名称供成员辨认';
const scenario = (id: string, label: string): ReviewScenario => ({ id, label });
const basicInputScenarios = [
  scenario('normal', '已填写'),
  scenario('empty', '空值'),
  scenario('unknown', '未知事实'),
  scenario('error', '错误'),
  scenario('readonly', '只读'),
  scenario('disabled', '禁用'),
  scenario('long-text', '长文本'),
];
const choiceScenarios = [
  scenario('normal', '可交互'),
  scenario('disabled', '禁用'),
  scenario('readonly', '只读'),
  scenario('long-text', '长文本'),
];
const pickerScenarios = [
  scenario('normal', '选择候选'),
  scenario('selected', '已选择'),
  scenario('loading', '加载中'),
  scenario('empty', '无候选'),
  scenario('error', '加载失败'),
  scenario('unavailable', '不可用候选'),
  scenario('readonly', '只读'),
  scenario('disabled', '禁用'),
  scenario('long-text', '长路径'),
];

export function ButtonDemo({ scenario: state }: ReviewDemoProps) {
  const [clicks, setClicks] = useScenarioState(state, 0);
  const [busy, setBusy] = useScenarioState(state, state === 'busy');
  return (
    <div className="vn-stack">
      <div className="vn-row">
        <Button
          busy={busy}
          disabled={state === 'disabled'}
          onClick={() => setClicks((count) => count + 1)}
        >
          {busy
            ? '处理中…'
            : state === 'long-text'
              ? '确认当前选择并继续检查所有尚未填写的必要信息'
              : '继续'}
        </Button>
        <Button
          variant="secondary"
          disabled={state === 'disabled'}
          onClick={() => setClicks((count) => count + 1)}
        >
          次要操作
        </Button>
        <Button
          variant="quiet"
          disabled={state === 'disabled'}
          onClick={() => setClicks((count) => count + 1)}
        >
          稍后处理
        </Button>
        <Button
          variant="danger"
          disabled={state === 'disabled'}
          onClick={() => setClicks((count) => count + 1)}
        >
          移除选择
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={state === 'disabled'}
          onClick={() => setClicks((count) => count + 1)}
        >
          小号
        </Button>
      </div>
      <span className="vn-muted" role="status">
        本地点击：{clicks} 次。Tab 聚焦后可按 Enter 或空格激活。
      </span>
      {state === 'busy' && (
        <Button variant="quiet" onClick={() => setBusy((current) => !current)}>
          {busy ? '解除演示忙碌状态' : '重新进入忙碌状态'}
        </Button>
      )}
    </div>
  );
}

export function IconButtonDemo({ scenario: state }: ReviewDemoProps) {
  const [action, setAction] = useScenarioState(state, '尚未触发操作');
  return (
    <div className="vn-stack">
      <div className="vn-row">
        <IconButton
          label="搜索物品"
          disabled={state === 'disabled'}
          busy={state === 'busy'}
          onClick={() => setAction('已触发本地搜索意图')}
        >
          <Search />
        </IconButton>
        <IconButton
          label="新增条目"
          variant="primary"
          disabled={state === 'disabled'}
          onClick={() => setAction('已触发本地新增意图')}
        >
          <Plus />
        </IconButton>
        <IconButton
          label={state === 'long-text' ? '关闭当前物品的补充信息面板并保留未完成草稿' : '关闭面板'}
          variant="secondary"
          disabled={state === 'disabled'}
          onClick={() => setAction('已触发本地关闭意图')}
        >
          <X />
        </IconButton>
      </div>
      <span className="vn-muted" role="status">
        {action}。按钮名称可由辅助技术读取。
      </span>
    </div>
  );
}

export function InputDemo({ scenario: state }: ReviewDemoProps) {
  const [value, setValue] = useScenarioState(
    state,
    state === 'empty' || state === 'unknown' || state === 'error'
      ? ''
      : state === 'long-text'
        ? longLabel
        : '燕麦饮',
  );
  return (
    <div className="vn-stack">
      <FormField
        label={state === 'long-text' ? longLabel : '显示名称'}
        hint={
          state === 'unknown'
            ? '名称尚未记录；空值不代表零或默认名称。'
            : state === 'readonly'
              ? '当前为只读，可选中复制内容。'
              : '输入只改变当前演示草稿。'
        }
        error={state === 'error' && !value.trim() ? '请输入可识别的名称。' : undefined}
      >
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={state === 'disabled'}
          readOnly={state === 'readonly'}
          placeholder={state === 'unknown' ? '尚未记录' : '例如：燕麦饮'}
        />
      </FormField>
      <span className="vn-muted" role="status">
        当前草稿：{value || '（空）'}
      </span>
    </div>
  );
}

export function TextareaDemo({ scenario: state }: ReviewDemoProps) {
  const [value, setValue] = useScenarioState(
    state,
    state === 'empty' || state === 'unknown' || state === 'error'
      ? ''
      : state === 'long-text'
        ? `${longLabel}。\n${longLabel}。\n请每次查看实物后再确认剩余情况。`
        : '开封后放入冰箱，和原有记录一起核对。',
  );
  return (
    <div className="vn-stack">
      <FormField
        label="备注"
        hint={
          state === 'unknown'
            ? '未填写表示没有备注事实。'
            : state === 'readonly'
              ? '只读内容仍可选择、复制。'
              : '支持换行；拖动底边可调整高度。'
        }
        error={
          state === 'error' && value.trim().length < 5
            ? '请补充至少 5 个字符，说明需要核对的事项。'
            : undefined
        }
      >
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={state === 'disabled'}
          readOnly={state === 'readonly'}
          placeholder="写下需要其他成员知道的信息"
        />
      </FormField>
      <span className="vn-muted" role="status">
        本地草稿 {value.length} 个字符
      </span>
    </div>
  );
}

export function FormFieldDemo({ scenario: state }: ReviewDemoProps) {
  const [value, setValue] = useScenarioState(state, state === 'long-text' ? longLabel : '');
  const [submitted, setSubmitted] = useScenarioState(state, state === 'error');
  const error = submitted && !value.trim() ? '请先填写名称，再继续。' : undefined;
  return (
    <form
      className="vn-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <FormField
        label={
          state === 'long-text'
            ? '供所有家庭成员辨认的完整物品名称（会显示在物品清单及详情中）'
            : '物品名称'
        }
        required
        disabled={state === 'disabled'}
        hint={
          state === 'readonly'
            ? '仅供查看；标签、帮助文本与输入框保持关联。'
            : '点击标签可聚焦输入框；帮助与错误信息均有语义关联。'
        }
        error={error}
      >
        {(props) => (
          <Input
            {...props}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            readOnly={state === 'readonly'}
            placeholder="例如：备用电池"
          />
        )}
      </FormField>
      <Button
        type="submit"
        variant="secondary"
        disabled={state === 'disabled' || state === 'readonly'}
      >
        检查本地字段
      </Button>
      <span className="vn-muted" role="status">
        {submitted
          ? error
            ? '请修正字段后再次检查。'
            : '本地字段检查通过；未发送任何请求。'
          : '尚未检查本地字段。'}
      </span>
    </form>
  );
}

export function BadgeDemo({ scenario: state }: ReviewDemoProps) {
  const [estimated, setEstimated] = useScenarioState(state, false);
  return (
    <div className="vn-stack">
      {state === 'long-text' ? (
        <Badge variant="warning">{longLabel}，该条记录仍待实物确认</Badge>
      ) : state === 'unknown' ? (
        <div className="vn-row">
          <Badge>未记录数量</Badge>
          <Badge variant="info">位置未知</Badge>
        </div>
      ) : (
        <div className="vn-row">
          <Badge>未记录</Badge>
          <Badge variant="accent">已选择</Badge>
          <Badge variant="success">已核对</Badge>
          <Badge variant="warning">待确认</Badge>
          <Badge variant="danger">存在冲突</Badge>
          <Badge variant="info">只读</Badge>
        </div>
      )}
      <div className="vn-row">
        <Badge variant={estimated ? 'warning' : 'neutral'}>
          {estimated ? '估计数量' : '数量未知'}
        </Badge>
        <Button variant="quiet" onClick={() => setEstimated((current) => !current)}>
          切换演示事实状态
        </Button>
      </div>
      <span className="vn-muted">标签通过文字表达状态；它本身没有点击行为。</span>
    </div>
  );
}

export function CheckboxDemo({ scenario: state }: ReviewDemoProps) {
  const [checked, setChecked] = useScenarioState<boolean | 'indeterminate'>(
    state,
    state === 'mixed' ? 'indeterminate' : state === 'checked',
  );
  return (
    <div className="vn-stack">
      <Checkbox
        checked={checked}
        onCheckedChange={setChecked}
        label={
          state === 'long-text'
            ? '同时选择当前范围内可以操作的全部物品，保留每件物品各自的位置和记录版本'
            : '选择当前可见物品'
        }
        description={
          state === 'error' && !checked
            ? '请至少选择一件物品。'
            : state === 'mixed'
              ? '混合状态表示仅部分已选择；点击将明确选择全部。'
              : state === 'disabled'
                ? '当前范围不可选择。'
                : '此处仅改变本地演示选择。'
        }
        invalid={state === 'error' && !checked}
        disabled={state === 'disabled'}
        readOnly={state === 'readonly'}
      />
      <span className="vn-muted" role="status">
        当前状态：{checked === 'indeterminate' ? '部分选择' : checked ? '已选择' : '未选择'}
      </span>
    </div>
  );
}

export function RadioGroupDemo({ scenario: state }: ReviewDemoProps) {
  const [value, setValue] = useScenarioState<string | null>(
    state,
    state === 'error' ? null : 'measured',
  );
  return (
    <div className="vn-stack">
      <RadioGroup
        label="数量依据"
        name="demo-accuracy"
        value={value}
        onValueChange={setValue}
        orientation={state === 'horizontal' ? 'horizontal' : 'vertical'}
        disabled={state === 'disabled'}
        readOnly={state === 'readonly'}
        invalid={state === 'error' && value === null}
        description={
          state === 'error' && value === null
            ? '请选择实际记录依据。'
            : '方向键移动并选择；未知表示没有可用依据。'
        }
        options={[
          { value: 'measured', label: '已测量', description: '来自实物计数或测量。' },
          {
            value: 'estimated',
            label: state === 'long-text' ? longLabel : '估计',
            description: '保留估计性质，不转换成精确数量。',
          },
          { value: 'unknown', label: '未知', description: '尚未记录数量。' },
          {
            value: 'imported',
            label: '从历史记录推算',
            description: '当前缺少历史依据。',
            disabled: true,
          },
        ]}
      />
      <span className="vn-muted" role="status">
        当前选择：
        {value === 'measured'
          ? '已测量'
          : value === 'estimated'
            ? '估计'
            : value === 'unknown'
              ? '未知'
              : '未选择'}
      </span>
    </div>
  );
}

export function SwitchDemo({ scenario: state }: ReviewDemoProps) {
  const [checked, setChecked] = useScenarioState(state, state === 'on');
  return (
    <div className="vn-stack">
      <Switch
        checked={checked}
        onCheckedChange={setChecked}
        label={
          state === 'long-text'
            ? '在当前查看范围中同时显示需要补充事实和等待核对的物品'
            : '显示补充信息'
        }
        description={
          state === 'disabled' ? '此查看范围不支持补充信息。' : '开关仅改变下面演示区域的可见内容。'
        }
        disabled={state === 'disabled'}
        readOnly={state === 'readonly'}
      />
      <span className="vn-muted" role="status">
        {checked ? '补充信息已显示：记录来源为人工核对。' : '补充信息已隐藏。'}
      </span>
    </div>
  );
}

const units: readonly SelectOption[] = [
  { value: 'bottle', label: '瓶', description: '适用于按独立瓶数记录。' },
  { value: 'box', label: '盒', description: '适用于按盒记录。' },
  { value: 'gram', label: '克', description: '需要填写相应重量。' },
  { value: 'unknown', label: '单位未记录', description: '明确保留未知事实。' },
];
export function SelectDemo({ scenario: state }: ReviewDemoProps) {
  const [value, setValue] = useScenarioState<string | null>(
    state,
    ['selected', 'readonly', 'disabled', 'long-text'].includes(state)
      ? 'bottle'
      : state === 'unavailable'
        ? 'archived'
        : null,
  );
  const [resolved, setResolved] = useScenarioState(state, false);
  const loading = state === 'loading' && !resolved;
  const error = state === 'error' && !resolved;
  const options =
    loading || error || state === 'empty'
      ? []
      : units.map((unit) => ({
          ...unit,
          label:
            state === 'long-text' && unit.value === 'bottle'
              ? '瓶（按每个独立包装完整记录，具体规格由物品事实单独描述）'
              : unit.label,
          disabled: state === 'unavailable' && unit.value === 'gram',
        }));
  return (
    <div className="vn-stack">
      <Select
        label="记录单位"
        value={value}
        onValueChange={setValue}
        options={options}
        selectedLabel={value === 'archived' ? '历史单位（当前不可用）' : undefined}
        disabled={state === 'disabled'}
        readOnly={state === 'readonly'}
        loading={loading}
        error={error ? '演示候选加载失败；当前没有可用结果。' : undefined}
        hint={
          state === 'unavailable'
            ? '历史选值仍保留；克在此场景中不可选。'
            : '使用上下方向键浏览候选，Enter 确认，Esc 关闭。'
        }
      />
      {(loading || error) && (
        <Button variant="secondary" onClick={() => setResolved(true)}>
          载入本地演示候选
        </Button>
      )}
      <span className="vn-muted" role="status">
        当前选值：
        {units.find((unit) => unit.value === value)?.label ?? (value ? '历史单位' : '未选择')}
      </span>
    </div>
  );
}

const locations: readonly SelectOption[] = [
  {
    value: 'item_0b0a1690-1024-4b43-b250-030a4709c701',
    label: '厨房抽屉',
    description: '位置物品 · 家中 / 厨房 / 岛台 / 上层抽屉',
  },
  {
    value: 'item_0b0a1690-1024-4b43-b250-030a4709c702',
    label: '厨房高柜',
    description: '位置物品 · 家中 / 厨房 / 北侧高柜 / 第二层 / 备用食物收纳盒',
  },
  {
    value: 'item_0b0a1690-1024-4b43-b250-030a4709c703',
    label: '工具收纳箱',
    description: '位置物品 · 家中 / 储藏间 / 门后层架 / 工具收纳箱',
  },
  {
    value: 'item_0b0a1690-1024-4b43-b250-030a4709c704',
    label: '已停用储物盒',
    description: '位置物品 · 家中 / 书房 / 旧储物盒 · 已停用',
    disabled: true,
  },
];
export function ComboboxDemo({ scenario: state }: ReviewDemoProps) {
  const initiallySelected = ['selected', 'readonly', 'disabled', 'long-text'].includes(state);
  const [value, setValue] = useScenarioState<string | null>(
    state,
    initiallySelected ? locations[0].value : null,
  );
  const [query, setQuery] = useScenarioState(
    state,
    initiallySelected ? locations[0].label : state === 'empty' ? '不存在的演示位置' : '',
  );
  const [resolved, setResolved] = useScenarioState(state, false);
  const loading = state === 'loading' && !resolved;
  const error = state === 'error' && !resolved;
  // The fixture owns search. Only this supplied candidate page is searched.
  const source =
    state === 'long-text'
      ? locations.map((option) => ({
          ...option,
          description: `${option.description} / 节日备用物品 / 需要多人共同核对的长期存放区域`,
        }))
      : locations;
  const filterQuery =
    locations.find((option) => option.value === value)?.label === query ? '' : query;
  const options =
    loading || error
      ? []
      : source.filter(
          (option) => !filterQuery || `${option.label} ${option.description}`.includes(filterQuery),
        );
  return (
    <div className="vn-stack">
      <Combobox
        label="搜索位置候选"
        value={value}
        onValueChange={(next) => setValue(next)}
        query={query}
        onQueryChange={setQuery}
        options={options}
        selectedLabel={locations.find((option) => option.value === value)?.label}
        loading={loading}
        error={error ? '候选加载失败。可在本地示例中重新载入候选。' : undefined}
        disabled={state === 'disabled'}
        readOnly={state === 'readonly'}
        hint="这是 4 条本地演示候选；不表示搜索了完整家庭库存。"
      />
      {(loading || error) && (
        <Button variant="secondary" onClick={() => setResolved(true)}>
          载入本地演示候选
        </Button>
      )}
      {state === 'unavailable' && (
        <span className="vn-muted">展开候选可看到已停用储物盒；该项不能选择。</span>
      )}
      <span className="vn-muted" role="status">
        当前选择：{locations.find((option) => option.value === value)?.label ?? '未选择'}；当前候选{' '}
        {options.length} 条
      </span>
    </div>
  );
}

export function TabsDemo({ scenario: state }: ReviewDemoProps) {
  const [value, setValue] = useScenarioState(
    state,
    state === 'loading' ? 'history' : state === 'empty' ? 'notes' : 'facts',
  );
  const [draft, setDraft] = useScenarioState(state, '这段草稿会在切换标签后保留');
  return (
    <div className="vn-stack">
      <Tabs
        value={value}
        onValueChange={setValue}
        label="物品信息演示"
        orientation={state === 'vertical' ? 'vertical' : 'horizontal'}
        variant={state === 'line' ? 'line' : 'default'}
        items={[
          {
            value: 'facts',
            label: state === 'long-text' ? '基本事实与所有需要核对的补充信息' : '基本事实',
            content: (
              <div className="vn-stack">
                <span>
                  数量：<Badge>未记录</Badge>
                </span>
                <FormField label="本地草稿" hint="切换到备注再返回，草稿保留。">
                  <Input value={draft} onChange={(event) => setDraft(event.target.value)} />
                </FormField>
              </div>
            ),
          },
          {
            value: 'notes',
            label: '备注',
            content: (
              <div className="vn-stack">
                <span>{state === 'empty' ? '目前没有备注记录。' : '当前备注仅用于组件评审。'}</span>
                <Button variant="quiet" onClick={() => setValue('facts')}>
                  返回基本事实
                </Button>
              </div>
            ),
          },
          {
            value: 'history',
            label: '变更记录',
            disabled: state === 'disabled',
            content: (
              <span>
                {state === 'loading'
                  ? '正在加载变更记录（本地状态演示）…'
                  : '尚未接入变更读取；这里不展示虚构历史。'}
              </span>
            ),
          },
        ]}
      />
      <span className="vn-muted" role="status">
        当前标签：{value === 'facts' ? '基本事实' : value === 'notes' ? '备注' : '变更记录'}
        。方向键移动焦点，Enter 或空格切换。
      </span>
    </div>
  );
}

export const controlsEntries: ReviewEntry[] = [
  {
    id: 'button',
    name: '按钮',
    group: '基础控件',
    description: 'Button：四种操作层级、忙碌状态与原生按钮语义。',
    component: ButtonDemo,
    scenarios: [
      scenario('normal', '操作层级'),
      scenario('busy', '忙碌'),
      scenario('disabled', '禁用'),
      scenario('long-text', '长文本'),
    ],
    storyId: 'rc1-controls--button',
  },
  {
    id: 'icon-button',
    name: '图标按钮',
    group: '基础控件',
    description: 'IconButton：可读操作名称和固定触摸目标。',
    component: IconButtonDemo,
    scenarios: [
      scenario('normal', '可交互'),
      scenario('busy', '忙碌'),
      scenario('disabled', '禁用'),
      scenario('long-text', '完整操作名称'),
    ],
    storyId: 'rc1-controls--icon-button',
  },
  {
    id: 'input',
    name: '单行输入',
    group: '基础控件',
    description: 'Input：受控输入、原生属性与关联错误。',
    component: InputDemo,
    scenarios: basicInputScenarios,
    storyId: 'rc1-controls--input',
  },
  {
    id: 'textarea',
    name: '多行输入',
    group: '基础控件',
    description: 'Textarea：换行、调整高度与草稿保留。',
    component: TextareaDemo,
    scenarios: basicInputScenarios,
    storyId: 'rc1-controls--textarea',
  },
  {
    id: 'form-field',
    name: '表单字段',
    group: '基础控件',
    description: 'FormField：标签、帮助和错误与控件关联。',
    component: FormFieldDemo,
    scenarios: [
      scenario('normal', '必填校验'),
      scenario('error', '错误'),
      scenario('readonly', '只读'),
      scenario('disabled', '禁用'),
      scenario('long-text', '长标签'),
    ],
    storyId: 'rc1-controls--form-field',
  },
  {
    id: 'badge',
    name: '状态标签',
    group: '基础控件',
    description: 'Badge：文字状态与语义色；不承载独立操作。',
    component: BadgeDemo,
    scenarios: [
      scenario('normal', '语义状态'),
      scenario('unknown', '未知事实'),
      scenario('long-text', '长文本'),
    ],
    storyId: 'rc1-controls--badge',
  },
  {
    id: 'checkbox',
    name: '复选框',
    group: '基础控件',
    description: 'Checkbox：选中、未选与混合状态，点击输出明确布尔值。',
    component: CheckboxDemo,
    scenarios: [
      scenario('normal', '未选择'),
      scenario('checked', '已选择'),
      scenario('mixed', '部分选择'),
      scenario('error', '错误'),
      ...choiceScenarios.slice(1),
    ],
    storyId: 'rc1-controls--checkbox',
  },
  {
    id: 'radio-group',
    name: '单选组',
    group: '基础控件',
    description: 'RadioGroup：组语义、方向键选择和禁用候选。',
    component: RadioGroupDemo,
    scenarios: [
      ...choiceScenarios,
      scenario('horizontal', '横向布局'),
      scenario('error', '未选择错误'),
    ],
    storyId: 'rc1-controls--radio-group',
  },
  {
    id: 'switch',
    name: '开关',
    group: '基础控件',
    description: 'Switch：即时切换本地呈现，保留只读语义。',
    component: SwitchDemo,
    scenarios: [scenario('normal', '关闭'), scenario('on', '开启'), ...choiceScenarios.slice(1)],
    storyId: 'rc1-controls--switch',
  },
  {
    id: 'select',
    name: '下拉选择',
    group: '基础控件',
    description: 'Select：预定义候选、键盘导航与明确加载状态。',
    component: SelectDemo,
    scenarios: pickerScenarios,
    storyId: 'rc1-controls--select',
  },
  {
    id: 'combobox',
    name: '搜索选择',
    group: '基础控件',
    description: 'Combobox：外部候选页和完整路径，不自行扩展搜索范围。',
    component: ComboboxDemo,
    scenarios: pickerScenarios,
    storyId: 'rc1-controls--combobox',
    limitations: '候选检索由调用者提供；此处只演示本地候选页。',
  },
  {
    id: 'tabs',
    name: '标签页',
    group: '基础控件',
    description: 'Tabs：键盘切换与持续挂载的面板草稿。',
    component: TabsDemo,
    scenarios: [
      scenario('normal', '草稿保留'),
      scenario('disabled', '禁用标签'),
      scenario('empty', '空内容'),
      scenario('loading', '加载内容'),
      scenario('long-text', '长标签'),
      scenario('vertical', '纵向布局'),
      scenario('line', '线型样式'),
    ],
    storyId: 'rc1-controls--tabs',
  },
];
