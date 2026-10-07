import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Alert, Button, Card, Drawer, Empty as AntEmpty, Form, Typography } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import { Link } from '@tanstack/react-router';
import { useViewport } from './theme';

export function Row({
  title,
  subtitle,
  detail,
  to,
  onClick,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  detail?: ReactNode;
  to?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="row-copy">
        <strong>{title}</strong>
        {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
      </span>
      {detail && <span className="row-detail">{detail}</span>}
      {(to || onClick) && <RightOutlined aria-hidden="true" />}
    </>
  );
  return to ? (
    <Link to={to} className="row">
      {content}
    </Link>
  ) : onClick ? (
    <Button type="text" block className="row" onClick={onClick}>
      {content}
    </Button>
  ) : (
    <div className="row">{content}</div>
  );
}
export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <Alert
      role={danger ? 'alert' : 'status'}
      type={danger ? 'error' : 'info'}
      showIcon
      title={children}
    />
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <AntEmpty
      description={
        <>
          <Typography.Title level={4}>{title}</Typography.Title>
          {children && <div>{children}</div>}
        </>
      }
    />
  );
}
/** Labels controlled domain fields without introducing a second form value store. */
export function FormField({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  error?: string;
}) {
  const id = useId();
  let first = true;
  const annotate = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (child) => {
      if (!isValidElement(child)) return child;
      const element = child as ReactElement<Record<string, unknown>>;
      if (
        'value' in element.props ||
        'defaultValue' in element.props ||
        'onChange' in element.props ||
        'name' in element.props
      ) {
        const controlId = first ? id : undefined;
        first = false;
        return cloneElement(element, {
          id: element.props.id ?? controlId,
          'aria-label': element.props['aria-label'] ?? label,
          ...(hint || error ? { 'aria-describedby': `${id}-help` } : {}),
          ...(error ? { 'aria-invalid': true } : {}),
        });
      }
      return element.props.children
        ? cloneElement(element, { children: annotate(element.props.children as ReactNode) })
        : child;
    });
  return (
    <Form.Item
      label={label}
      htmlFor={id}
      layout="vertical"
      validateStatus={error ? 'error' : undefined}
      help={error || hint ? <span id={`${id}-help`}>{error || hint}</span> : undefined}
    >
      {annotate(children)}
    </Form.Item>
  );
}
/** The same mounted drawer survives viewport changes; draft ownership stays with the caller. */
export function ActionDrawer({
  title,
  children,
  onClose,
  busy = false,
  context,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  context?: ReactNode;
  footer?: ReactNode;
}) {
  const { mobile } = useViewport();
  const [opener] = useState(() => {
    const element = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return { element, id: element?.id };
  });
  useEffect(
    () => () => {
      // Responsive detail panels may replace the original trigger while this drawer stays mounted.
      requestAnimationFrame(() => {
        const target = opener.element?.isConnected
          ? opener.element
          : opener.id
            ? document.getElementById(opener.id)
            : null;
        target?.focus({ preventScroll: true });
      });
    },
    [opener],
  );
  const [height, setHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  useEffect(() => {
    const update = () => setHeight(window.visualViewport?.height ?? window.innerHeight);
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return (
    <Drawer
      open
      title={title}
      size={mobile ? '100%' : 560}
      onClose={() => {
        if (!busy) onClose();
      }}
      keyboard={!busy}
      mask={{ closable: !busy }}
      closable={busy ? false : { 'aria-label': '关闭' }}
      getContainer={() => document.body}
      className="action-drawer"
      styles={{
        section: { height },
        body: { padding: mobile ? 16 : 24 },
        footer: { padding: '12px 24px max(12px, env(safe-area-inset-bottom))' },
      }}
      footer={footer}
    >
      <div className="stack">
        {context && <Card size="small">{context}</Card>}
        {children}
      </div>
    </Drawer>
  );
}
