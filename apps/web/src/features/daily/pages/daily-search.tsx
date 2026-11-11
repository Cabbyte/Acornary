import { PageHeader } from '../../../ui/patterns/page-header';
import { BrowseContent } from './browse-content';
import type { DailyBrowseProps } from './models';

export function DailySearch(props: DailyBrowseProps) {
  return (
    <section className="vn-daily-page">
      <PageHeader title="搜索结果" onBack={props.onBack} backLabel="返回我的物品" />
      <BrowseContent {...props} />
    </section>
  );
}
