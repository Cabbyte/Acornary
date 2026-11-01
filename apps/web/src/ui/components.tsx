import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Alert, Button, Card, Empty as AntEmpty, Form, Typography } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import { Link } from '@tanstack/react-router';
import { Sheet } from './primitives/index.js';

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
  return (
    <Sheet title={title} onClose={onClose} busy={busy} footer={footer} size="wide">
      <div className="stack">
        {context && <Card size="small">{context}</Card>}
        {children}
      </div>
    </Sheet>
  );
}
