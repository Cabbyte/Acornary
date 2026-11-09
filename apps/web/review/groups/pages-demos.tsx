import type { ReviewDemoProps, ReviewEntry } from '../types';
import { PageJourney } from '../pages/PageJourney';
import { pageDefinitions } from '../pages/catalog';

export function HomePageDemo({ scenario }: ReviewDemoProps) {
  return <PageJourney initialPath={pageDefinitions[0].path} scenario={scenario} />;
}
export function SearchPageDemo({ scenario }: ReviewDemoProps) {
  return <PageJourney initialPath={pageDefinitions[1].path} scenario={scenario} />;
}
export function ProductPageDemo({ scenario }: ReviewDemoProps) {
  return <PageJourney initialPath={pageDefinitions[2].path} scenario={scenario} />;
}
export function ItemPageDemo({ scenario }: ReviewDemoProps) {
  return <PageJourney initialPath={pageDefinitions[3].path} scenario={scenario} />;
}
export function AttentionPageDemo({ scenario }: ReviewDemoProps) {
  return <PageJourney initialPath="/attention" scenario={scenario} />;
}
export function ActivityPageDemo({ scenario }: ReviewDemoProps) {
  return <PageJourney initialPath="/activity" scenario={scenario} />;
}
export function IntakePageDemo({ scenario }: ReviewDemoProps) {
  return <PageJourney initialPath="/tasks/intake" scenario={scenario} />;
}
export function NewProductPageDemo({ scenario }: ReviewDemoProps) {
  return <PageJourney initialPath="/tasks/new-product" scenario={scenario} />;
}
export function ConsumePageDemo({ scenario }: ReviewDemoProps) {
  return <PageJourney initialPath="/tasks/consume" scenario={scenario} />;
}
export function MovePageDemo({ scenario }: ReviewDemoProps) {
  return <PageJourney initialPath="/tasks/move" scenario={scenario} />;
}
const demos = [
  HomePageDemo,
  SearchPageDemo,
  ProductPageDemo,
  ItemPageDemo,
  AttentionPageDemo,
  ActivityPageDemo,
  IntakePageDemo,
  NewProductPageDemo,
  ConsumePageDemo,
  MovePageDemo,
];
export const pageEntries: ReviewEntry[] = pageDefinitions.map((page, index) => ({
  id: page.id,
  kind: 'page',
  name: page.name,
  group:
    index >= 10
      ? '完整页面 · 全产品候选'
      : index < 4
        ? '完整页面 · P01'
        : index < 6
          ? '完整页面 · P02'
          : '完整页面 · P03',
  version: index >= 10 ? 'Pages-RC1' : index < 4 ? 'P01-RC1' : index < 6 ? 'P02-RC1' : 'P03-RC1',
  description:
    index >= 10
      ? '日常、管理与设置页面 · 隔离数据，逐页审阅。'
      : index >= 6
        ? '日常任务 · 隔离适配器驱动，逐页审阅。'
        : '日常浏览链路，可连续导航；每页单独审阅。',
  component:
    demos[index] || (({ scenario }) => <PageJourney initialPath={page.path} scenario={scenario} />),
  source: `apps/web/src/features/daily/pages/${page.source}.tsx`,
  storyId: `pages-daily--${page.story}`,
  scenarios:
    index >= 10
      ? [
          { id: 'normal', label: '正常' },
          { id: 'loading', label: '加载' },
          { id: 'empty', label: '空数据' },
          { id: 'error', label: '失败重试' },
          { id: 'offline', label: '离线' },
          { id: 'forbidden', label: '无权限' },
          { id: 'session-changed', label: '身份变化' },
          { id: 'conflict', label: '冲突' },
          { id: 'unknown', label: '不确定结果' },
          { id: 'mcp', label: '受限宿主' },
          ...(page.id.startsWith('page-manage-')
            ? [
                { id: 'hidden', label: '隐藏选中项' },
                { id: 'selection-limit', label: '100 件选择边界' },
                { id: 'unknown-template', label: '未知模板字段' },
                { id: 'partial-history', label: '历史部分加载' },
              ]
            : page.id === 'page-settings-auth'
              ? [
                  { id: 'login', label: '尚未登录' },
                  { id: 'oauth', label: '服务授权' },
                  { id: 'invite-expired', label: '邀请已过期' },
                  { id: 'password-error', label: '凭据失败' },
                ]
              : page.id === 'page-settings-cache'
                ? [
                    { id: 'offline-empty', label: '离线无缓存' },
                    { id: 'storage-error', label: '存储不可用' },
                  ]
                : page.id === 'page-daily-scan'
                  ? [{ id: 'camera-denied', label: '相机不可用' }]
                  : page.id === 'page-daily-labels'
                    ? [{ id: 'print-unknown', label: '打印结果不确定' }]
                    : []),
        ]
      : index >= 6
        ? [
            { id: 'normal', label: '正常任务' },
            { id: 'unknown', label: '提交后结果不确定' },
            { id: 'conflict', label: '版本冲突' },
            { id: 'offline', label: '离线' },
            { id: 'forbidden', label: '无权限' },
            { id: 'session-changed', label: '身份变化' },
            { id: 'contract-gap', label: '新商品类型能力契约缺口' },
          ]
        : [
            { id: 'normal', label: '正常 · 可连续浏览' },
            {
              id: 'pagination',
              label: index < 4 ? '分页样例 · 每页 5 条' : '分页样例 · 每页 1 条',
            },
            { id: 'loading', label: '正在读取' },
            { id: 'empty', label: index < 2 || index > 3 ? '没有记录' : '记录不可用' },
            { id: 'error', label: '读取失败 · 可重试' },
            { id: 'forbidden', label: '无权限' },
            { id: 'offline', label: '离线 · 部分缓存' },
            { id: 'offline-empty', label: '离线 · 无缓存' },
            { id: 'session-changed', label: '身份变化' },
          ],
  limitations: '读写均使用隔离 fixture；真实服务、权限、缓存、MCP 与设备验收尚未执行。',
}));
