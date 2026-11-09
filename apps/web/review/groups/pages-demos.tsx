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
  group: index < 4 ? '完整页面 · P01' : index < 6 ? '完整页面 · P02' : '完整页面 · P03',
  version: index < 4 ? 'P01-RC1' : index < 6 ? 'P02-RC1' : 'P03-RC1',
  description:
    index >= 6
      ? '日常任务 · 隔离适配器驱动，逐页审阅。'
      : '日常浏览链路，可连续导航；每页单独审阅。',
  component: demos[index],
  source: `apps/web/src/features/daily/pages/${page.source}.tsx`,
  storyId: `pages-daily--${page.story}`,
  scenarios:
    index >= 6
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
          { id: 'pagination', label: index < 4 ? '分页样例 · 每页 5 条' : '分页样例 · 每页 1 条' },
          { id: 'loading', label: '正在读取' },
          { id: 'empty', label: index < 2 || index > 3 ? '没有记录' : '记录不可用' },
          { id: 'error', label: '读取失败 · 可重试' },
          { id: 'forbidden', label: '无权限' },
          { id: 'offline', label: '离线 · 部分缓存' },
          { id: 'offline-empty', label: '离线 · 无缓存' },
          { id: 'session-changed', label: '身份变化' },
        ],
  limitations: '只读适配器为隔离 fixture；真实服务端分页、权限、缓存及 MCP 验收尚未执行。',
}));
