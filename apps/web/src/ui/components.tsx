import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type ButtonHTMLAttributes,
} from 'react';
import { Link } from '@tanstack/react-router';

export function Button({
  children,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <button {...props} className={`button ${variant} ${props.className ?? ''}`}>
      {children}
    </button>
  );
}
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
        <span className="row-title">{title}</span>
        {subtitle && <span className="row-subtitle">{subtitle}</span>}
      </span>
      {detail && <span className="row-detail">{detail}</span>}
      {(to || onClick) && (
        <span className="chevron" aria-hidden="true">
          ›
        </span>
      )}
    </>
  );
  return to ? (
    <Link to={to} className="row">
      {content}
    </Link>
  ) : onClick ? (
    <button type="button" className="row" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="row">{content}</div>
  );
}
export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <div className={`notice ${danger ? 'notice-error' : ''}`} role={danger ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function Field({
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
  const annotate = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (child) => {
      if (!isValidElement(child)) return child;
      const element = child as ReactElement<Record<string, unknown>>;
      if (['input', 'select', 'textarea'].includes(String(element.type)))
        return cloneElement(element, {
          'aria-label': element.props['aria-label'] ?? label,
          ...(hint || error ? { 'aria-describedby': id } : {}),
          ...(error ? { 'aria-invalid': true } : {}),
        });
      return element.props.children
        ? cloneElement(element, { children: annotate(element.props.children as ReactNode) })
        : child;
    });
  return (
    <div className="field">
      <span>{label}</span>
      {annotate(children)}
      {(hint || error) && (
        <small id={id} className={error ? 'field-error' : undefined}>
          {error || hint}
        </small>
      )}
    </div>
  );
}
export function Sheet({
  title,
  children,
  onClose,
  busy = false,
  desktopPage = false,
  context,
  core = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  desktopPage?: boolean;
  context?: ReactNode;
  core?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const change = () => setWide(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const page = desktopPage && wide;
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (page) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Native dialog handles focus containment, Escape and restoration; the viewport follows the keyboard.
    const resize = () => {
      dialog.style.maxHeight = `${(window.visualViewport?.height ?? window.innerHeight) - 16}px`;
    };
    resize();
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus();
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [page]);
  if (page)
    return (
      <section className={`editor-page ${core ? 'core-editor' : ''}`} aria-labelledby={titleId}>
        <header className="page-header">
          <h1 id={titleId}>{title}</h1>
          <button className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="editor-columns">
          <div>{children}</div>
          <aside className="stack">{context}</aside>
        </div>
      </section>
    );
  return (
    <dialog
      className="sheet"
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close.current();
      }}
    >
      <div className="sheet-handle" aria-hidden="true" />
      <header className="sheet-header">
        <button className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}>
          ×
        </button>
        <h2 id={titleId}>{title}</h2>
        <span />
      </header>
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}
