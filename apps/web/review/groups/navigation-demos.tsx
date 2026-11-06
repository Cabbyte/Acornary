import { ReviewNote, ReviewFeedback } from '../review-frame';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from '../../src/ui/components/ui/button';
import { FormField } from '../../src/ui/components/ui/form-field';
import { Input } from '../../src/ui/components/ui/input';
import { InlineNotice } from '../../src/ui/components/ui/inline-notice';
import { AppShell } from '../../src/ui/patterns/app-shell';
import { AppearancePicker } from '../../src/ui/patterns/appearance-picker';
import { DesktopNavigation, type NavigationLink } from '../../src/ui/patterns/desktop-navigation';
import { HouseholdSwitcher, type HouseholdOption } from '../../src/ui/patterns/household-switcher';
import { MobileNavigation } from '../../src/ui/patterns/mobile-navigation';
import { ModeSwitcher, modeLabels } from '../../src/ui/patterns/mode-switcher';
import tokenSource from '../../src/ui/tokens/source.json';
import type { AppearancePreset, UIMode } from '../../src/ui/theme/provider';
import { useReviewAppearance } from '../appearance-context';
import type { ReviewDemoProps, ReviewEntry, ReviewScenario } from '../types';

const householdOptions: readonly HouseholdOption[] = [
  {
    id: 'household_6b5a7491-294e-4bda-a56b-6a96ea0d6271',
    name: '林间小家',
    description: '示例家庭 · 可切换范围',
  },
  {
    id: 'household_c7cb83ae-a62b-44e6-9dfd-e0883ac1530c',
    name: '周末小屋',
    description: '另一个独立的示例家庭',
  },
  {
    id: 'household_9a60bfac-076c-42d1-b953-9e4288986254',
    name: '暂不可访问的家庭',
    description: '访问资格待核对',
    disabled: true,
  },
];
const navigationLinks: readonly NavigationLink[] = [
  { id: 'items', label: '物品', href: '/review-fixture/items' },
  { id: 'attention', label: '留意', href: '/review-fixture/attention' },
  { id: 'catalog', label: '目录', href: '/review-fixture/catalog' },
  { id: 'locations', label: '位置', href: '/review-fixture/locations' },
  { id: 'activity', label: '动态', href: '/review-fixture/activity' },
  { id: 'settings', label: '设置', href: '/review-fixture/settings' },
];
const pendingReason = '正在等待上一次操作的确认，请先核对任务结果。';

function useDemoAppearance() {
  const review = useReviewAppearance();
  const [mode, setMode] = useState<UIMode>('daily');
  const [preset, setPreset] = useState<AppearancePreset>('sage');
  return review ?? { mode, preset, onModeChange: setMode, onPresetChange: setPreset };
}
function DemoMessage({ children }: { children: ReactNode }) {
  return <ReviewFeedback>{children}</ReviewFeedback>;
}
function linksForScenario(scenario: string): readonly NavigationLink[] {
  if (scenario === 'empty') return [];
  return navigationLinks.map((link) => ({
    ...link,
    label:
      scenario === 'long-text' && link.id === 'items' ? '家庭共同维护的全部具体物品' : link.label,
    disabled: scenario === 'unavailable' && (link.id === 'activity' || link.id === 'catalog'),
    disabledReason: '当前范围未开放此入口',
  }));
}
function householdsForScenario(scenario: string): readonly HouseholdOption[] {
  if (scenario === 'empty') return [];
  return householdOptions.map((option, index) => ({
    ...option,
    name:
      scenario === 'long-text' && index === 0
        ? '由多位家庭成员共同管理的林间小家与长期储物空间'
        : option.name,
  }));
}

export const modeSwitcherScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '正常 · 实际切换模式' },
  { id: 'compact', label: '窄屏文字入口' },
  { id: 'pending-operation', label: '操作结果待确认' },
  { id: 'disabled', label: '禁用' },
  { id: 'readonly', label: '只读' },
];
export const appearancePickerScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '四组真实配色' },
  { id: 'disabled', label: '禁用' },
  { id: 'readonly', label: '只读' },
];
export const desktopNavigationScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '正常' },
  { id: 'pending-operation', label: '模式切换被保护' },
  { id: 'loading', label: '正在加载' },
  { id: 'empty', label: '无导航项' },
  { id: 'disabled', label: '全部禁用' },
  { id: 'unavailable', label: '部分入口不可用' },
  { id: 'no-add', label: '无添加能力' },
  { id: 'long-text', label: '长导航标签' },
];
export const mobileNavigationScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '正常 · 切换两种模式' },
  { id: 'loading', label: '正在加载' },
  { id: 'empty', label: '无导航项' },
  { id: 'disabled', label: '全部禁用' },
  { id: 'unavailable', label: '部分入口不可用' },
  { id: 'no-add', label: '无添加能力' },
  { id: 'long-text', label: '长导航标签' },
];
export const householdSwitcherScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '正常 · 家庭范围' },
  { id: 'empty', label: '无可用家庭' },
  { id: 'unknown', label: '当前家庭暂不可用' },
  { id: 'loading', label: '读取家庭中' },
  { id: 'error', label: '读取失败' },
  { id: 'pending-operation', label: '未完成操作保护' },
  { id: 'disabled', label: '禁用' },
  { id: 'readonly', label: '只读' },
  { id: 'long-text', label: '长家庭名称' },
];
export const appShellScenarios: readonly ReviewScenario[] = [
  { id: 'normal', label: '完整结构 · 保留草稿' },
  { id: 'narrow', label: '窄容器' },
  { id: 'pending-operation', label: '待确认任务与切换保护' },
  { id: 'loading', label: '导航与家庭加载中' },
  { id: 'empty', label: '无家庭范围' },
  { id: 'error', label: '家庭范围读取失败' },
  { id: 'disabled', label: '暂不可操作' },
  { id: 'long-text', label: '长名称与标签' },
];

export function ModeSwitcherDemo({ scenario }: ReviewDemoProps) {
  const appearance = useDemoAppearance();
  const [message, setMessage] = useState('');
  return (
    <div className="vn-stack vn-navigation-demo">
      <ModeSwitcher
        value={appearance.mode}
        onValueChange={(next) => {
          appearance.onModeChange(next);
          setMessage(`已切换预览到${modeLabels[next]}模式。`);
        }}
        layout={scenario === 'compact' ? 'compact' : 'inline'}
        disabled={scenario === 'disabled'}
        readOnly={scenario === 'readonly'}
        blockedReason={scenario === 'pending-operation' ? pendingReason : undefined}
      />
      <PersistentDraft />
      <DemoMessage>{message}</DemoMessage>
    </div>
  );
}

export function AppearancePickerDemo({ scenario }: ReviewDemoProps) {
  const appearance = useDemoAppearance();
  const [message, setMessage] = useState('');
  return (
    <div className="vn-stack vn-navigation-demo">
      <AppearancePicker
        value={appearance.preset}
        mode={appearance.mode}
        onValueChange={(next) => {
          appearance.onPresetChange(next);
          setMessage(`预览已选「${tokenSource.presets[next].name}」，使用模式保持不变。`);
        }}
        disabled={scenario === 'disabled'}
        readOnly={scenario === 'readonly'}
      />
      <PersistentDraft />
      <DemoMessage>{message}</DemoMessage>
    </div>
  );
}

export function DesktopNavigationDemo({ scenario }: ReviewDemoProps) {
  const appearance = useDemoAppearance();
  const [activePath, setActivePath] = useState(navigationLinks[0].href);
  const [message, setMessage] = useState('');
  return (
    <div className="vn-stack vn-navigation-demo">
      <div className="vn-navigation-demo__sidebar">
        <DesktopNavigation
          mode={appearance.mode}
          onModeChange={(next) => {
            appearance.onModeChange(next);
            setMessage(`预览已切换到${modeLabels[next]}模式。`);
          }}
          links={linksForScenario(scenario)}
          activePath={activePath}
          onNavigate={(href, link) => {
            setActivePath(href);
            setMessage(`收到「${link.label}」导航意图：${href}`);
          }}
          onAdd={
            scenario === 'no-add' ? undefined : () => setMessage('收到添加物品意图；未创建物品。')
          }
          disabled={scenario === 'disabled'}
          loading={scenario === 'loading'}
          modeBlockedReason={scenario === 'pending-operation' ? pendingReason : undefined}
        />
      </div>
      <DemoMessage>{message}</DemoMessage>
    </div>
  );
}

export function MobileNavigationDemo({ scenario }: ReviewDemoProps) {
  const appearance = useDemoAppearance();
  const [activePath, setActivePath] = useState(navigationLinks[0].href);
  const [message, setMessage] = useState('');
  return (
    <div className="vn-stack vn-navigation-demo">
      <div className="vn-navigation-demo__mobile">
        <ModeSwitcher
          value={appearance.mode}
          onValueChange={(next) => {
            appearance.onModeChange(next);
            setMessage(`当前为${modeLabels[next]}模式导航。`);
          }}
          layout="compact"
        />
        <MobileNavigation
          mode={appearance.mode}
          links={linksForScenario(scenario)}
          activePath={activePath}
          onNavigate={(href, link) => {
            setActivePath(href);
            setMessage(`收到「${link.label}」导航意图：${href}`);
          }}
          onAdd={
            scenario === 'no-add' ? undefined : () => setMessage('收到添加物品意图；未创建物品。')
          }
          disabled={scenario === 'disabled'}
          loading={scenario === 'loading'}
        />
      </div>
      <DemoMessage>{message}</DemoMessage>
    </div>
  );
}

export function HouseholdSwitcherDemo({ scenario }: ReviewDemoProps) {
  const [household, setHousehold] = useState(householdOptions[0].id);
  const [message, setMessage] = useState('');
  return (
    <div className="vn-stack vn-navigation-demo">
      <HouseholdSwitcher
        value={
          scenario === 'empty'
            ? null
            : scenario === 'unknown'
              ? 'household_22ac326e-4cbb-448e-9580-91c6e8f573f7'
              : household
        }
        options={householdsForScenario(scenario)}
        onSwitchIntent={(id) => {
          setHousehold(id);
          setMessage(`已选择示例家庭：${id}；没有发起认证或网络请求。`);
        }}
        currentLabel={scenario === 'unknown' ? '上次选择的家庭（暂不可用）' : undefined}
        disabled={scenario === 'disabled'}
        loading={scenario === 'loading'}
        readOnly={scenario === 'readonly'}
        error={scenario === 'error' ? '家庭范围读取未完成，不能判断访问资格。' : undefined}
        blockedReason={
          scenario === 'pending-operation'
            ? '当前家庭仍有待确认的操作，暂不能切换范围。'
            : undefined
        }
      />
      <DemoMessage>{message}</DemoMessage>
    </div>
  );
}

function PersistentDraft({ disabled = false }: { disabled?: boolean }) {
  const [draft, setDraft] = useState('留给晚饭的燕麦饮');
  const id = useId();
  return (
    <div className="vn-navigation-demo__draft">
      <h2 className="vn-navigation-demo__title">一份正在编辑的草稿</h2>
      <p className="vn-muted">输入内容后切换模式、配色或宽度，草稿会继续保留在此处。</p>
      <FormField id={id} label="物品备注" hint="仅供预览，不会保存到家庭。" disabled={disabled}>
        <Input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={disabled}
        />
      </FormField>
      <p className="vn-muted">当前内容：{draft || '（空）'}</p>
    </div>
  );
}

export function AppShellDemo({ scenario }: ReviewDemoProps) {
  const appearance = useDemoAppearance();
  const [narrow, setNarrow] = useState(scenario === 'narrow');
  const [activePath, setActivePath] = useState(navigationLinks[0].href);
  const [household, setHousehold] = useState(householdOptions[0].id);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setNarrow(scenario === 'narrow');
  }, [scenario]);
  const pending = scenario === 'pending-operation';
  return (
    <div className="vn-stack vn-navigation-demo">
      <div className="vn-row">
        <Button
          variant="secondary"
          onClick={() => {
            setNarrow((value) => !value);
            setMessage('已更改预览容器宽度，草稿保持在同一主体区域。');
          }}
        >
          {narrow ? '展开预览宽度' : '切换窄屏宽度'}
        </Button>
        <span className="vn-muted">
          当前：{modeLabels[appearance.mode]}模式 · {tokenSource.presets[appearance.preset].name}
        </span>
      </div>
      <div className="vn-navigation-demo__shell-frame" data-narrow={narrow}>
        <AppShell
          mode={appearance.mode}
          onModeChange={(next) => {
            appearance.onModeChange(next);
            setMessage(`已切换${modeLabels[next]}模式，草稿继续保留。`);
          }}
          preset={appearance.preset}
          onPresetChange={(next) => {
            appearance.onPresetChange(next);
            setMessage(`已选择「${tokenSource.presets[next].name}」，草稿继续保留。`);
          }}
          links={linksForScenario(scenario)}
          activePath={activePath}
          onNavigate={(href, link) => {
            setActivePath(href);
            setMessage(`收到「${link.label}」导航意图；预览保留同一草稿。`);
          }}
          householdId={scenario === 'empty' ? null : household}
          households={householdsForScenario(scenario)}
          onHouseholdSwitchIntent={(id) => {
            setHousehold(id);
            setMessage(`已切换示例范围：${id}；未载入真实家庭。`);
          }}
          onAdd={
            scenario === 'empty'
              ? undefined
              : () => setMessage('收到添加物品意图；预览未执行写入。')
          }
          disabled={scenario === 'disabled'}
          loading={scenario === 'loading'}
          householdLoading={scenario === 'loading'}
          householdError={scenario === 'error' ? '家庭范围读取未完成，请稍后核对。' : undefined}
          modeBlockedReason={pending ? pendingReason : undefined}
          householdBlockedReason={pending ? '请先核对当前家庭待确认的操作。' : undefined}
          recoveredTask={
            pending ? (
              <InlineNotice
                tone="warning"
                title="有一项操作等待核对"
                action={
                  <Button
                    variant="secondary"
                    onClick={() => setMessage('收到继续核对原任务的意图；没有重新提交操作。')}
                  >
                    继续核对
                  </Button>
                }
              >
                当前没有可靠回执，切换模式与家庭暂不可用。
              </InlineNotice>
            ) : undefined
          }
        >
          <PersistentDraft disabled={scenario === 'disabled'} />
        </AppShell>
      </div>
      <DemoMessage>{message}</DemoMessage>
    </div>
  );
}

export const navigationEntries: ReviewEntry[] = [
  {
    id: 'mode-switcher',
    name: '使用模式切换',
    group: '导航与外观',
    description: 'ModeSwitcher · 日常 / 管理受控值、桌面文字选项与窄屏弹层；未完成操作保护。',
    component: ModeSwitcherDemo,
    scenarios: modeSwitcherScenarios,
    storyId: 'rc1-navigation--mode-switcher',
  },
  {
    id: 'appearance-picker',
    name: '界面配色选择',
    group: '导航与外观',
    description: 'AppearancePicker · 中央 Token 中的四组配色，选择与业务模式相互独立。',
    component: AppearancePickerDemo,
    scenarios: appearancePickerScenarios,
    storyId: 'rc1-navigation--appearance-picker',
  },
  {
    id: 'desktop-navigation',
    name: '桌面导航',
    group: '导航与外观',
    description: 'DesktopNavigation · 文本与图标、独立添加意图、左下设置与模式切换。',
    component: DesktopNavigationDemo,
    scenarios: desktopNavigationScenarios,
    storyId: 'rc1-navigation--desktop-navigation',
  },
  {
    id: 'mobile-navigation',
    name: '移动导航',
    group: '导航与外观',
    description: 'MobileNavigation · 日常四入口 / 管理五入口，至少 44px 目标，添加保持独立操作。',
    component: MobileNavigationDemo,
    scenarios: mobileNavigationScenarios,
    storyId: 'rc1-navigation--mobile-navigation',
  },
  {
    id: 'household-switcher',
    name: '家庭范围切换',
    group: '导航与外观',
    description: 'HouseholdSwitcher · 完整家庭身份与切换意图，加载、未知范围和未完成操作保护。',
    component: HouseholdSwitcherDemo,
    scenarios: householdSwitcherScenarios,
    storyId: 'rc1-navigation--household-switcher',
    limitations: '仅展示调用方提供的家庭，不连接账号、认证或远程范围控制器。',
  },
  {
    id: 'app-shell',
    name: '应用框架',
    group: '导航与外观',
    description:
      'AppShell · 基于自身容器宽度的导航区域，单一主体树，模式 / 配色 / 宽度切换保留草稿。',
    component: AppShellDemo,
    scenarios: appShellScenarios,
    storyId: 'rc1-navigation--app-shell',
    limitations:
      '只组装展示区域；路由、主题提供器、权限、家庭切换和任务恢复由外部接线。未做真实客户端验收。',
  },
];
