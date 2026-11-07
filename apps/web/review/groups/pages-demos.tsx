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
const demos = [HomePageDemo, SearchPageDemo, ProductPageDemo, ItemPageDemo];
export const pageEntries: ReviewEntry[] = pageDefinitions.map((page, index) => ({
  id: page.id,
  kind: 'page',
  name: page.name,
  group: '完整页面 · P01',
  version: 'P01-RC1',
  description: '日常浏览链路，可连续导航；每页单独审阅。',
  component: demos[index],
  source: `apps/web/src/features/daily/pages/${page.source}.tsx`,
  storyId: `pages-daily--${page.story}`,
  scenarios: [
    { id: 'normal', label: '正常 · 可连续浏览' },
    { id: 'pagination', label: '分页样例 · 每页 5 条' },
    { id: 'loading', label: '正在读取' },
    { id: 'empty', label: index < 2 ? '没有记录' : '记录不可用' },
    { id: 'error', label: '读取失败 · 可重试' },
    { id: 'forbidden', label: '无权限' },
    { id: 'offline', label: '离线 · 部分缓存' },
    { id: 'offline-empty', label: '离线 · 无缓存' },
    { id: 'session-changed', label: '身份变化' },
  ],
  limitations: '只读适配器为隔离 fixture；真实服务端分页、权限、缓存及 MCP 验收尚未执行。',
}));
