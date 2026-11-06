import { useEffect, useState } from 'react';
import { ArrowRight, Eye, MoveRight, Trash2 } from 'lucide-react';
import type { ReviewDemoProps, ReviewEntry, ReviewScenario } from '../types';
import { Dialog, DialogClose } from '../../src/ui/components/ui/dialog';
import { Sheet } from '../../src/ui/components/ui/sheet';
import { AlertDialog, AlertDialogClose } from '../../src/ui/components/ui/alert-dialog';
import { Popover } from '../../src/ui/components/ui/popover';
import { Tooltip } from '../../src/ui/components/ui/tooltip';
import { DropdownMenu } from '../../src/ui/components/ui/dropdown-menu';
import { Toast } from '../../src/ui/components/ui/toast';
import { InlineNotice } from '../../src/ui/components/ui/inline-notice';
import { Skeleton } from '../../src/ui/components/ui/skeleton';
import { EmptyState, type EmptyStateReason } from '../../src/ui/patterns/empty-state';
import { LoadingState, type LoadingStateProps } from '../../src/ui/patterns/loading-state';

const actionClass = 'vn-overlays-demo-action';
const longContext =
  '这是一段刻意保留完整内容的长说明：储物柜第二层靠左的透明收纳盒，包含不同规格、不同来源与不同录入时间的记录。当前读取范围和来源需要完整呈现，不应为了压缩高度而省略关键条件。';
export const modalScenarios: readonly ReviewScenario[] = [
  { id: 'draft', label: '草稿 / 键盘' },
  { id: 'busy', label: '处理中 / 禁止关闭' },
  { id: 'unknown', label: '结果未知 / 禁止关闭' },
  { id: 'blocked', label: '任务阻断' },
  { id: 'loading', label: '读取中' },
  { id: 'error', label: '读取错误' },
  { id: 'empty', label: '无内容' },
  { id: 'readonly', label: '只读' },
  { id: 'long-text', label: '长文本' },
];

function ModalDemo({ scenario, kind }: ReviewDemoProps & { kind: 'dialog' | 'sheet' | 'alert' }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('客厅侧柜');
  const [released, setReleased] = useState(false);
  const [message, setMessage] = useState('尚未触发操作。');
  useEffect(() => {
    setOpen(false);
    setReleased(false);
    setMessage('尚未触发操作。');
  }, [scenario]);
  const busy = scenario === 'busy' && !released;
  const closeBlockedReason =
    !released && scenario === 'unknown'
      ? '结果尚未确认。先读取当前状态，避免把关闭误认为已取消。'
      : !released && scenario === 'blocked'
        ? '任务需要先保留草稿，才能关闭面板。'
        : undefined;
  const blocked = busy || !!closeBlockedReason;
  const Component = kind === 'sheet' ? Sheet : kind === 'alert' ? AlertDialog : Dialog;
  const Close = kind === 'alert' ? AlertDialogClose : DialogClose;
  const label = kind === 'sheet' ? '任务面板' : kind === 'alert' ? '确认对话框' : '对话框';
  const recovery = (
    <button
      type="button"
      className={actionClass}
      onClick={() => {
        setReleased(true);
        setMessage('演示驱动已解除限制；未执行服务器操作。');
      }}
    >
      演示：解除关闭限制
    </button>
  );
  const content =
    scenario === 'loading' ? (
      <LoadingState label="正在读取面板内容" />
    ) : scenario === 'empty' ? (
      <EmptyState reason="empty" context="演示读取范围内没有需要处理的条目。" />
    ) : scenario === 'error' && !released ? (
      <InlineNotice
        tone="danger"
        title="面板内容读取失败"
        action={
          <button
            type="button"
            className={actionClass}
            onClick={() => {
              setReleased(true);
              setMessage('已切换为本地草稿演示。');
            }}
          >
            演示：重试读取
          </button>
        }
      >
        没有得到可用结果，未把失败显示为空记录。
      </InlineNotice>
    ) : (
      <div className="vn-stack">
        <label className="vn-overlays-demo-field">
          草稿名称
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            readOnly={scenario === 'readonly'}
            disabled={busy}
          />
        </label>
        {scenario === 'readonly' && <p className="vn-muted">此场景只允许查看，名称不可修改。</p>}
        {scenario === 'long-text' && (
          <>
            {[1, 2, 3, 4].map((part) => (
              <p key={part}>{longContext}</p>
            ))}
          </>
        )}
        {kind === 'alert' && (
          <InlineNotice tone="warning" title="请核对当前选择" announce={false}>
            确认只会记录本地演示意图。关闭或取消不会触发确认。
          </InlineNotice>
        )}
      </div>
    );
  return (
    <div className="vn-stack">
      <p className="vn-muted">
        本地交互演示。Tab 切换焦点；Escape 或关闭按钮请求关闭。主题切换保留草稿。
      </p>
      <Component
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setMessage('已关闭面板，草稿仍保留。');
        }}
        title={
          scenario === 'long-text'
            ? `确认${longContext}`
            : kind === 'alert'
              ? '确认当前选择？'
              : `编辑位置 · ${label}`
        }
        description={
          kind === 'alert'
            ? '请检查影响范围后再确认。此对话框不会因点击外部而关闭。'
            : '关闭策略由当前任务状态决定，面板本身只发出意图。'
        }
        trigger={
          <button type="button" className={actionClass}>
            打开{label}
          </button>
        }
        busy={busy}
        closeBlockedReason={closeBlockedReason}
        onCloseBlocked={(reason) => setMessage(`已拦截关闭：${reason}`)}
        footer={
          <>
            {blocked ? recovery : <Close className={actionClass}>取消并保留草稿</Close>}
            <button
              type="button"
              className={actionClass}
              data-primary
              disabled={
                blocked ||
                scenario === 'readonly' ||
                scenario === 'loading' ||
                scenario === 'empty' ||
                (scenario === 'error' && !released)
              }
              onClick={() =>
                setMessage(
                  `已收到${kind === 'alert' ? '确认' : '预览'}意图：${draft}（仅本地演示）。`,
                )
              }
            >
              {busy ? '处理中…' : kind === 'alert' ? '确认演示选择' : '预览草稿'}
            </button>
          </>
        }
      >
        {content}
        <p className="vn-overlays-demo-log" role="status">
          {message}
        </p>
      </Component>
      <p className="vn-overlays-demo-log">保留的草稿：{draft}</p>
      <p className="vn-overlays-demo-log" role="status">
        {message}
      </p>
    </div>
  );
}
export function DialogDemo(props: ReviewDemoProps) {
  return <ModalDemo {...props} kind="dialog" />;
}
export function SheetDemo(props: ReviewDemoProps) {
  return <ModalDemo {...props} kind="sheet" />;
}
export function AlertDialogDemo(props: ReviewDemoProps) {
  return <ModalDemo {...props} kind="alert" />;
}

export const popoverScenarios: readonly ReviewScenario[] = [
  { id: 'keyboard', label: '键盘 / 默认' },
  { id: 'open', label: '展开' },
  { id: 'disabled', label: '禁用' },
  { id: 'loading', label: '加载' },
  { id: 'error', label: '错误' },
  { id: 'long-text', label: '长文本' },
];
export function PopoverDemo({ scenario }: ReviewDemoProps) {
  const [open, setOpen] = useState(scenario === 'open');
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setOpen(scenario === 'open');
    setExpanded(false);
  }, [scenario]);
  return (
    <div className="vn-stack">
      <p>日期依据：包装标注。补充说明不改变这一事实。</p>
      <Popover
        open={open}
        onOpenChange={setOpen}
        disabled={scenario === 'disabled'}
        title="关于日期依据"
        description="补充内容，关键事实已显示在面板外。"
        trigger={
          <button type="button" className={actionClass}>
            查看说明
          </button>
        }
      >
        {scenario === 'loading' ? (
          <LoadingState layout="compact" label="正在读取补充说明" />
        ) : scenario === 'error' && !expanded ? (
          <InlineNotice
            tone="danger"
            title="补充说明读取失败"
            action={
              <button type="button" className={actionClass} onClick={() => setExpanded(true)}>
                演示：重新读取
              </button>
            }
          />
        ) : (
          <>
            <p>
              {scenario === 'long-text'
                ? longContext
                : '记录保留了日期依据；补充说明不推算新的日期。'}
            </p>
            <button type="button" className={actionClass} onClick={() => setExpanded(!expanded)}>
              {expanded ? '收起示例依据' : '展开示例依据'}
            </button>
            {expanded && <p role="status">演示依据：录入时选择「包装标注」。没有发起网络请求。</p>}
          </>
        )}
      </Popover>
      <p className="vn-overlays-demo-log" role="status">
        补充说明：{open ? '已展开' : '已收起'}。
      </p>
    </div>
  );
}

export const tooltipScenarios: readonly ReviewScenario[] = [
  { id: 'keyboard', label: '悬停 / 键盘' },
  { id: 'open', label: '展开' },
  { id: 'disabled', label: '禁用' },
  { id: 'long-text', label: '长文本' },
];
export function TooltipDemo({ scenario }: ReviewDemoProps) {
  const [open, setOpen] = useState(scenario === 'open');
  const [message, setMessage] = useState('尚未触发查看。');
  useEffect(() => {
    setOpen(scenario === 'open');
    setMessage('尚未触发查看。');
  }, [scenario]);
  return (
    <div className="vn-stack">
      <p>查看记录会显示当前条目的完整信息。关键说明不依赖 Tooltip。</p>
      <div className="vn-row">
        <Tooltip
          open={open}
          onOpenChange={setOpen}
          disabled={scenario === 'disabled'}
          trigger={
            <button
              type="button"
              className={actionClass}
              disabled={scenario === 'disabled'}
              onClick={() => setMessage('已收到查看记录意图（本地演示）。')}
            >
              <Eye size={16} aria-hidden="true" />
              查看记录
            </button>
          }
        >
          {scenario === 'long-text' ? longContext : '打开当前条目的详情；不会修改记录。'}
        </Tooltip>
      </div>
      {scenario === 'disabled' && (
        <p className="vn-muted">当前示例没有可查看的条目，按钮已禁用。</p>
      )}
      <p className="vn-overlays-demo-log" role="status">
        {message}
      </p>
    </div>
  );
}

export const menuScenarios: readonly ReviewScenario[] = [
  { id: 'keyboard', label: '键盘 / 默认' },
  { id: 'open', label: '展开' },
  { id: 'disabled', label: '禁用入口' },
  { id: 'readonly', label: '只读操作' },
  { id: 'empty', label: '没有操作' },
  { id: 'long-text', label: '长文本' },
];
export function DropdownMenuDemo({ scenario }: ReviewDemoProps) {
  const [open, setOpen] = useState(scenario === 'open');
  const [message, setMessage] = useState('尚未选择操作。');
  useEffect(() => {
    setOpen(scenario === 'open');
    setMessage('尚未选择操作。');
  }, [scenario]);
  return (
    <div className="vn-stack">
      <div className="vn-row">
        <DropdownMenu
          open={open}
          onOpenChange={setOpen}
          disabled={scenario === 'disabled'}
          trigger={
            <button type="button" className={actionClass}>
              更多操作
            </button>
          }
          items={
            scenario === 'empty'
              ? []
              : [
                  {
                    id: 'view',
                    label:
                      scenario === 'long-text' ? `查看完整记录与来源：${longContext}` : '查看记录',
                    icon: <Eye size={16} />,
                  },
                  {
                    id: 'move',
                    label: '移动到其他位置',
                    icon: <MoveRight size={16} />,
                    disabledReason:
                      scenario === 'readonly' ? '当前为只读权限，无法移动。' : undefined,
                  },
                  {
                    id: 'remove',
                    label: '移除本地选择',
                    icon: <Trash2 size={16} />,
                    tone: 'danger',
                    separatorBefore: true,
                    description: '仅清除演示选中状态',
                    disabledReason:
                      scenario === 'readonly' ? '此演示场景禁止变更选择。' : undefined,
                  },
                ]
          }
          onSelect={(id) => setMessage(`已收到操作意图：${id}（仅本地演示）。`)}
        />
      </div>
      <p className="vn-muted">方向键切换，Enter 选择，Escape 返回触发按钮。禁用项附带原因。</p>
      <p className="vn-overlays-demo-log" role="status">
        {message}
      </p>
    </div>
  );
}

export const toastScenarios: readonly ReviewScenario[] = [
  { id: 'info', label: '普通通知' },
  { id: 'success', label: '本地选择回馈' },
  { id: 'error', label: '错误' },
  { id: 'unknown', label: '结果未知' },
  { id: 'long-text', label: '长文本' },
];
export function ToastDemo({ scenario }: ReviewDemoProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('通知尚未显示。');
  useEffect(() => {
    setOpen(false);
    setMessage('通知尚未显示。');
  }, [scenario]);
  const tone =
    scenario === 'error'
      ? 'danger'
      : scenario === 'unknown'
        ? 'warning'
        : scenario === 'success'
          ? 'success'
          : 'info';
  const title =
    scenario === 'error'
      ? '读取未完成'
      : scenario === 'unknown'
        ? '结果尚未确认'
        : scenario === 'success'
          ? '已选中两条演示记录'
          : '辅助提示';
  return (
    <div className="vn-stack">
      <InlineNotice tone={tone} title={`常驻信息：${title}`} announce={false}>
        {scenario === 'long-text'
          ? longContext
          : '重要信息持续显示在面板中，关闭辅助通知不会清除它。'}
      </InlineNotice>
      <div className="vn-row">
        <button
          type="button"
          className={actionClass}
          onClick={() => {
            setOpen(true);
            setMessage('辅助通知已显示。');
          }}
        >
          显示辅助通知
        </button>
      </div>
      <Toast
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setMessage(next ? '辅助通知已显示。' : '辅助通知已关闭；常驻信息仍在。');
        }}
        title={title}
        tone={tone}
        description={
          scenario === 'long-text' ? longContext : '此通知只辅助提示，请以面板中的常驻信息为准。'
        }
        action={
          <button
            type="button"
            className={actionClass}
            onClick={() => setMessage('已收到查看常驻信息意图（演示）。')}
          >
            查看说明
          </button>
        }
      />
      <p className="vn-overlays-demo-log" role="status">
        {message}
      </p>
    </div>
  );
}

export const noticeScenarios: readonly ReviewScenario[] = [
  { id: 'info', label: '信息' },
  { id: 'success', label: '成功提示' },
  { id: 'warning', label: '警告' },
  { id: 'error', label: '错误 / 重试' },
  { id: 'unknown', label: '未知' },
  { id: 'dismissible', label: '可关闭' },
  { id: 'long-text', label: '长文本' },
];
export function InlineNoticeDemo({ scenario }: ReviewDemoProps) {
  const [visible, setVisible] = useState(true);
  const [message, setMessage] = useState('尚未触发提示操作。');
  useEffect(() => {
    setVisible(true);
    setMessage('尚未触发提示操作。');
  }, [scenario]);
  const tone =
    scenario === 'error'
      ? 'danger'
      : scenario === 'warning' || scenario === 'unknown'
        ? 'warning'
        : scenario === 'success'
          ? 'success'
          : 'info';
  return (
    <div className="vn-stack">
      {visible ? (
        <InlineNotice
          tone={tone}
          title={
            scenario === 'unknown'
              ? '当前结果未知'
              : scenario === 'error'
                ? '读取未完成'
                : scenario === 'success'
                  ? '本地选择已更新'
                  : '请留意当前读取范围'
          }
          onDismiss={
            scenario === 'dismissible'
              ? () => {
                  setVisible(false);
                  setMessage('提示已关闭。');
                }
              : undefined
          }
          action={
            scenario === 'error' ? (
              <button
                type="button"
                className={actionClass}
                onClick={() => setMessage('已收到重新读取意图；本演示没有业务请求。')}
              >
                重新读取
              </button>
            ) : undefined
          }
        >
          {scenario === 'long-text'
            ? longContext
            : scenario === 'unknown'
              ? '尚未收到可确认的结果。没有推断成功、失败或零库存。'
              : '这里只呈现传入状态，不负责写入业务数据。'}
        </InlineNotice>
      ) : (
        <button
          type="button"
          className={actionClass}
          onClick={() => {
            setVisible(true);
            setMessage('提示已恢复。');
          }}
        >
          重新显示提示
        </button>
      )}
      <p className="vn-overlays-demo-log" role="status">
        {message}
      </p>
    </div>
  );
}

export const skeletonScenarios: readonly ReviewScenario[] = [
  { id: 'text', label: '文字占位' },
  { id: 'row', label: '列表占位' },
  { id: 'card', label: '卡片占位' },
];
export function SkeletonDemo({ scenario }: ReviewDemoProps) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [scenario]);
  return (
    <div className="vn-stack">
      <p role="status">
        {loaded ? '本地演示内容已显示。' : '正在加载演示内容；占位形状不代表数量。'}
      </p>
      <div className="vn-overlays-demo-card" aria-busy={!loaded}>
        {loaded ? (
          <>
            <h3 className="vn-section-title">透明收纳盒</h3>
            <p>当前数量未知，尚未录入。</p>
          </>
        ) : (
          <Skeleton variant={scenario === 'card' ? 'card' : scenario === 'row' ? 'row' : 'text'} />
        )}
      </div>
      <div className="vn-row">
        <button type="button" className={actionClass} onClick={() => setLoaded(!loaded)}>
          {loaded ? '演示：重新加载' : '演示：显示内容'}
        </button>
      </div>
    </div>
  );
}

export const emptyScenarios: readonly ReviewScenario[] = [
  { id: 'empty', label: '确认为空' },
  { id: 'no-match', label: '没有匹配' },
  { id: 'permission', label: '权限不足' },
  { id: 'error', label: '读取错误' },
  { id: 'unknown', label: '未知' },
  { id: 'offline', label: '离线' },
  { id: 'long-text', label: '长文本' },
];
export function EmptyStateDemo({ scenario }: ReviewDemoProps) {
  const [message, setMessage] = useState('尚未触发恢复操作。');
  useEffect(() => setMessage('尚未触发恢复操作。'), [scenario]);
  const reason: EmptyStateReason =
    scenario === 'long-text'
      ? 'no-match'
      : ['empty', 'no-match', 'permission', 'error', 'unknown', 'offline'].includes(scenario)
        ? (scenario as EmptyStateReason)
        : 'empty';
  const actionLabel =
    reason === 'empty'
      ? '添加第一条记录'
      : reason === 'no-match'
        ? '调整筛选条件'
        : reason === 'permission'
          ? '查看权限说明'
          : '重新读取';
  return (
    <div className="vn-stack">
      <EmptyState
        reason={reason}
        context={scenario === 'long-text' ? longContext : undefined}
        recoveryAction={
          <button
            type="button"
            className={actionClass}
            onClick={() => setMessage(`已收到「${actionLabel}」意图（仅本地演示）。`)}
          >
            {actionLabel}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        }
      />
      <p className="vn-overlays-demo-log" role="status">
        {message}
      </p>
    </div>
  );
}

export const loadingScenarios: readonly ReviewScenario[] = [
  { id: 'loading', label: '正在读取' },
  { id: 'delayed', label: '等待较久' },
  { id: 'error', label: '读取失败' },
  { id: 'unknown', label: '结果未知' },
  { id: 'compact', label: '紧凑状态' },
  { id: 'card', label: '卡片占位' },
  { id: 'long-text', label: '长文本' },
];
export function LoadingStateDemo({ scenario }: ReviewDemoProps) {
  const [ready, setReady] = useState(false);
  const [retried, setRetried] = useState(false);
  useEffect(() => {
    setReady(false);
    setRetried(false);
  }, [scenario]);
  const state: LoadingStateProps['state'] = retried
    ? 'loading'
    : scenario === 'error' || scenario === 'unknown' || scenario === 'delayed'
      ? scenario
      : 'loading';
  return (
    <div className="vn-stack">
      {ready ? (
        <InlineNotice tone="info" title="已显示本地演示内容">
          此状态由演示按钮切换；未证明远端读取成功。
        </InlineNotice>
      ) : (
        <LoadingState
          state={state}
          layout={scenario === 'compact' ? 'compact' : scenario === 'card' ? 'card' : 'list'}
          context={
            scenario === 'long-text'
              ? longContext
              : state === 'unknown'
                ? '尚无可确认的读取结果，不展示零条记录。'
                : state === 'delayed'
                  ? '仍在等待读取。当前没有可依据的进度百分比。'
                  : undefined
          }
          recoveryAction={
            state === 'error' || state === 'unknown' || state === 'delayed' ? (
              <button type="button" className={actionClass} onClick={() => setRetried(true)}>
                演示：重新读取
              </button>
            ) : undefined
          }
        />
      )}
      <div className="vn-row">
        <button
          type="button"
          className={actionClass}
          onClick={() => {
            setReady(!ready);
            setRetried(false);
          }}
        >
          {ready ? '演示：返回读取状态' : '演示：显示内容'}
        </button>
      </div>
    </div>
  );
}

export const overlaysEntries: ReviewEntry[] = [
  {
    id: 'dialog',
    name: '对话框',
    group: '浮层与反馈',
    description: 'Dialog · 受控关闭、焦点管理和草稿保留',
    component: DialogDemo,
    scenarios: modalScenarios,
    storyId: 'rc1-overlays--dialog',
  },
  {
    id: 'sheet',
    name: '任务面板',
    group: '浮层与反馈',
    description: 'Sheet · 同一表单跨尺寸定位，所有关闭入口统一守卫',
    component: SheetDemo,
    scenarios: modalScenarios,
    storyId: 'rc1-overlays--sheet',
  },
  {
    id: 'popover',
    name: '补充信息浮层',
    group: '浮层与反馈',
    description: 'Popover · 关键事实之外的补充说明',
    component: PopoverDemo,
    scenarios: popoverScenarios,
    storyId: 'rc1-overlays--popover',
  },
  {
    id: 'tooltip',
    name: '简短提示',
    group: '浮层与反馈',
    description: 'Tooltip · 悬停与键盘焦点的辅助说明',
    component: TooltipDemo,
    scenarios: tooltipScenarios,
    storyId: 'rc1-overlays--tooltip',
  },
  {
    id: 'dropdown-menu',
    name: '操作菜单',
    group: '浮层与反馈',
    description: 'DropdownMenu · 键盘导航与禁用原因',
    component: DropdownMenuDemo,
    scenarios: menuScenarios,
    storyId: 'rc1-overlays--dropdown-menu',
  },
  {
    id: 'alert-dialog',
    name: '确认对话框',
    group: '浮层与反馈',
    description: 'AlertDialog · 明确确认意图及任务关闭守卫',
    component: AlertDialogDemo,
    scenarios: modalScenarios,
    storyId: 'rc1-overlays--alert-dialog',
  },
  {
    id: 'toast',
    name: '辅助通知',
    group: '浮层与反馈',
    description: 'Toast · 受控通知，重要信息仍常驻面板',
    component: ToastDemo,
    scenarios: toastScenarios,
    storyId: 'rc1-overlays--toast',
  },
  {
    id: 'inline-notice',
    name: '行内提示',
    group: '浮层与反馈',
    description: 'InlineNotice · 信息、警告、错误与显式恢复',
    component: InlineNoticeDemo,
    scenarios: noticeScenarios,
    storyId: 'rc1-overlays--inline-notice',
  },
  {
    id: 'skeleton',
    name: '加载占位',
    group: '浮层与反馈',
    description: 'Skeleton · 装饰性占位，不代表真实数量',
    component: SkeletonDemo,
    scenarios: skeletonScenarios,
    storyId: 'rc1-overlays--skeleton',
  },
  {
    id: 'empty-state',
    name: '空与不可读状态',
    group: '浮层与反馈',
    description: 'EmptyState · 区分确认为空、无匹配、权限和未知',
    component: EmptyStateDemo,
    scenarios: emptyScenarios,
    storyId: 'rc1-overlays--empty-state',
  },
  {
    id: 'loading-state',
    name: '读取状态',
    group: '浮层与反馈',
    description: 'LoadingState · 等待、失败、未知及恢复动作',
    component: LoadingStateDemo,
    scenarios: loadingScenarios,
    storyId: 'rc1-overlays--loading-state',
  },
];
