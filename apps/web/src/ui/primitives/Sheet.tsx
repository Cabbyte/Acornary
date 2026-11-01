import { Drawer } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import { tokens } from '../tokens.js';
import styles from './Sheet.module.css';

export interface SheetProps {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  /** Busy sheets cannot be dismissed by Escape, mask click, or the close button. */
  busy?: boolean;
  /** Desktop width: narrow = 480px, wide = 560px. Mobile is always full screen. */
  size?: 'narrow' | 'wide';
  className?: string;
}

const MOBILE_QUERY = '(max-width: 767px)';

function useIsMobile() {
  const [mobile, setMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return mobile;
}

/**
 * A right-side action sheet built on Ant Drawer. Render it only while open; on
 * unmount focus returns to the element that opened it. Mobile is full screen.
 */
export function Sheet({
  title,
  children,
  footer,
  onClose,
  busy = false,
  size = 'narrow',
  className,
}: SheetProps) {
  const mobile = useIsMobile();
  const width = size === 'wide' ? tokens.sheets.wide : tokens.sheets.narrow;
  const [opener] = useState(() => {
    const element = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return { element, id: element?.id };
  });

  useEffect(
    () => () => {
      // Responsive layouts may replace the original trigger while this sheet stays mounted.
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

  return (
    <Drawer
      open
      footer={footer}
      placement="right"
      title={<h2 className={styles.title}>{title}</h2>}
      size={mobile ? '100%' : width}
      onClose={() => {
        if (!busy) onClose();
      }}
      keyboard={!busy}
      mask={{ closable: !busy }}
      closable={busy ? false : { 'aria-label': '关闭' }}
      focusable={{ focusTriggerAfterClose: false, trap: true }}
      getContainer={() => document.body}
      rootClassName={className}
      classNames={{ close: styles.close }}
      styles={{
        section: { height: '100%' },
        header: {
          borderBottom: '1px solid var(--ac-line)',
          paddingInline: mobile ? tokens.spacing[4] : tokens.spacing[5],
        },
        body: {
          padding: mobile ? tokens.spacing[4] : tokens.spacing[5],
          overflowY: 'auto',
        },
        footer: {
          borderTop: '1px solid var(--ac-line)',
          background: 'var(--ac-surface)',
          padding: mobile
            ? `${tokens.spacing[3]}px ${tokens.spacing[4]}px`
            : `${tokens.spacing[3]}px ${tokens.spacing[5]}px`,
        },
        close: {
          width: tokens.controls.touch,
          height: tokens.controls.touch,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      }}
    >
      {children}
    </Drawer>
  );
}
