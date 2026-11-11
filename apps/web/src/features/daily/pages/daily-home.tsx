import { PageHeader } from '../../../ui/patterns/page-header';
import { BrowseContent } from './browse-content';
import type { DailyBrowseProps } from './models';

export function DailyHome(props: DailyBrowseProps) {
  return (
    <section className="vn-daily-page">
      <PageHeader
        title="我的物品"
        primaryAction={
          props.onTask
            ? {
                id: 'add',
                label: '添加',
                availability: { kind: 'available' },
                onAction: () => props.onTask?.('intake'),
              }
            : undefined
        }
      />
      <BrowseContent {...props} />
    </section>
  );
}
