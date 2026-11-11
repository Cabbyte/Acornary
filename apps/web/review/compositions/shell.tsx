import { useState } from 'react';
import { AppShell } from '../../src/ui/patterns/app-shell';
import type { NavigationLink } from '../../src/ui/patterns/desktop-navigation';
import { ItemCard } from '../../src/ui/patterns/item-card';
import { PendingOperationBanner } from '../../src/ui/patterns/pending-operation-banner';
import { FormField } from '../../src/ui/components/ui/form-field';
import { Input } from '../../src/ui/components/ui/input';
import { InlineNotice } from '../../src/ui/components/ui/inline-notice';
import type { AppearancePreset, UIMode } from '../../src/ui/theme/provider';
import { useReviewAppearance } from '../appearance-context';
import { items, householdId } from '../fixtures';
import { ReviewNote } from '../review-frame';
import type { ReviewDemoProps } from '../types';
const secondHousehold = 'household_00000000-0000-4000-8000-000000000002';
export function ShellComposition({ scenario }: ReviewDemoProps) {
  const env = useReviewAppearance();
  const [localMode, setLocalMode] = useState<UIMode>('daily');
  const [localPreset, setLocalPreset] = useState<AppearancePreset>('sage');
  const mode = env?.mode ?? localMode;
  const preset = env?.preset ?? localPreset;
  const [household, setHousehold] = useState(householdId);
  const [drafts, setDrafts] = useState<Record<string, string>>({
    [householdId]: '冷藏层还有一盒燕麦饮',
    [secondHousehold]: '',
  });
  const [path, setPath] = useState('/items');
  const [message, setMessage] = useState('');
  const busy = scenario === 'pending';
  const links: NavigationLink[] =
    mode === 'daily'
      ? [
          { id: 'items', label: '物品', href: '/items' },
          { id: 'attention', label: '留意', href: '/attention' },
          { id: 'activity', label: '动态', href: '/activity' },
          { id: 'settings', label: '设置', href: '/settings?mode=daily' },
        ]
      : [
          { id: 'items', label: '物品', href: '/manage/items' },
          { id: 'catalog', label: '目录', href: '/manage/catalog' },
          { id: 'locations', label: '位置', href: '/manage/locations' },
          { id: 'activity', label: '动态', href: '/manage/activity' },
          { id: 'settings', label: '设置', href: '/settings?mode=management' },
        ];
  return (
    <div className="review-composition--wide">
      <ReviewNote>输入后切换配色、模式或宽度，检查草稿连续性。导航只更新当前示例。</ReviewNote>
      <AppShell
        mode={mode}
        preset={preset}
        onModeChange={(next) => {
          if (busy) return;
          (env?.onModeChange ?? setLocalMode)(next);
          setPath(next === 'daily' ? '/items' : '/manage/items');
        }}
        onPresetChange={env?.onPresetChange ?? setLocalPreset}
        links={links}
        activePath={links.some((link) => link.href === path) ? path : links[0].href}
        onNavigate={(href) => {
          setPath(href);
          setMessage(`当前预览位置：${href}。内容仍为 Shell 示例。`);
        }}
        householdId={household}
        households={[
          {
            id: householdId,
            name: scenario === 'long-text' ? '我们共同生活的家与很长的家庭显示名称' : '示例家庭',
          },
          { id: secondHousehold, name: '另一个示例家庭' },
        ]}
        onHouseholdSwitchIntent={(id) => {
          if (!busy) {
            setHousehold(id);
            setMessage('已切换隔离示例范围；两个家庭的草稿各自保留。');
          }
        }}
        modeBlockedReason={busy ? '当前任务正在提交，请等待结果后切换。' : undefined}
        householdBlockedReason={busy ? '当前任务正在提交，暂不能切换家庭。' : undefined}
        onAdd={() => setMessage('已触发添加入口意图；此组合不创建库存。')}
        recoveredTask={
          scenario === 'recovery' && household === householdId ? (
            <PendingOperationBanner
              taskId="preview-shell-retained-01"
              title="保留的物品修改"
              scopeLabel={household === householdId ? '示例家庭' : '另一个示例家庭'}
              state="retained"
              originalAttemptAvailable
              recoveryAvailability={{ kind: 'available' }}
              onInspectOriginal={() => setMessage('已记录核对原任务意图；任务引用保持不变。')}
              onRetainAndLeave={() => setMessage('原任务仍保留，未发起替代请求。')}
            />
          ) : busy ? (
            <InlineNotice tone="info" title="正在提交的任务">
              此为隔离状态样例，模式与家庭入口暂不可操作。
            </InlineNotice>
          ) : undefined
        }
      >
        <div className="review-shell-body">
          <h2 className="vn-section-title">物品速记</h2>
          <FormField label="本次示例草稿">
            <Input
              value={drafts[household] ?? ''}
              onChange={(e) => setDrafts({ ...drafts, [household]: e.target.value })}
            />
          </FormField>
          {household === householdId ? (
            <ItemCard
              item={items[0]}
              quantity={{ value: '310.0', unit: 'mL', accuracy: 'estimated' }}
              onOpen={(id) => setMessage(`查看物品意图：${id}`)}
            />
          ) : (
            <InlineNotice tone="info" title="另一个示例范围">
              此家庭没有提供物品 fixture；不会显示前一个家庭的物品。
            </InlineNotice>
          )}
          {message && (
            <InlineNotice tone="info" title="预览反馈">
              {message}
            </InlineNotice>
          )}
        </div>
      </AppShell>
    </div>
  );
}
