import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { PageHeader } from '../../../ui/patterns/page-header';
import { Button } from '../../../ui/components/ui/button';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import { Skeleton } from '../../../ui/components/ui/skeleton';
import type { SettingsPageProps, SettingsReadState } from './models';
import './settings-pages.css';

export function SettingsLayout({
  title,
  household,
  navigate,
  notice,
  children,
  back = '/settings',
  context,
}: SettingsPageProps & {
  title: string;
  children: ReactNode;
  back?: string | null;
  context?: string;
}) {
  return (
    <section className="vn-settings-page">
      <PageHeader
        title={title}
        context={context || household.name}
        onBack={back ? () => navigate(back) : undefined}
        backLabel={back === '/settings' ? '返回设置' : '返回上一页'}
      />
      {notice && <InlineNotice tone={notice.tone} title={notice.message} />}
      {children}
    </section>
  );
}
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="vn-settings-section">
      <div className="vn-settings-section-heading">
        <h2>{title}</h2>
        {description && <p className="vn-settings-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}
export function SettingsLink({
  title,
  detail,
  onClick,
  icon,
}: {
  title: string;
  detail: string;
  onClick: () => void;
  icon?: ReactNode;
}) {
  return (
    <button type="button" className="vn-settings-link" onClick={onClick}>
      {icon && (
        <span className="vn-settings-link-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="vn-settings-link-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <ChevronRight size={17} aria-hidden="true" />
    </button>
  );
}
export function SettingsFacts({
  values,
}: {
  values: readonly { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="vn-settings-facts">
      {values.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function SettingsReadBoundary({
  state,
  onRetry,
  children,
}: {
  state: SettingsReadState;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (state === 'loading')
    return (
      <div className="vn-settings-stack" role="status">
        <p>正在读取此区块…</p>
        <Skeleton variant="row" lines={2} />
        <Skeleton variant="row" lines={2} />
        <Button variant="secondary" onClick={onRetry}>
          显示读取结果
        </Button>
      </div>
    );
  if (state === 'error')
    return (
      <InlineNotice
        tone="danger"
        title="此区块暂时无法读取"
        action={
          <Button variant="secondary" onClick={onRetry}>
            重试读取
          </Button>
        }
      >
        保留当前页面和查询条件，读取失败不代表没有数据。
      </InlineNotice>
    );
  if (state === 'forbidden')
    return (
      <InlineNotice tone="warning" title="没有读取此区块的权限">
        你仍可返回设置，查看自己的账号与连接状态。
      </InlineNotice>
    );
  return <>{children}</>;
}
