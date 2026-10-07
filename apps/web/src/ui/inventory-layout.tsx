import { Splitter } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const widthKey = 'acornary-location-panel-width';
const defaultWidth = 224;
const minWidth = 180;
const maxWidth = 320;
let rememberedWidth = defaultWidth;
const clamp = (n: number, max = maxWidth) => Math.max(minWidth, Math.min(max, n));

export function useLocationPanelWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(widthKey);
      if (saved !== null && Number.isFinite(Number(saved))) rememberedWidth = clamp(Number(saved));
    } catch {
      // Opaque MCP iframes have no storage access. Retain the session preference in memory.
    }
    return rememberedWidth;
  });
  const remember = (value: number) => {
    rememberedWidth = clamp(value);
    setWidth(rememberedWidth);
    try {
      localStorage.setItem(widthKey, String(rememberedWidth));
    } catch {
      // Storage denial must not prevent browsing or resizing.
    }
  };
  return { width, setWidth, remember };
}

export function useContentWidth() {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const update = () => setWidth(element.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref, width };
}

/** Keep the list mounted while the location tree switches between inline and drawer. */
export function InventoryColumns({
  inline,
  width,
  max,
  onResize,
  onRemember,
  tree,
  children,
}: {
  inline: boolean;
  width: number;
  max: number;
  onResize: (width: number) => void;
  onRemember: (width: number) => void;
  tree: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = clamp(width, max);
  useEffect(() => {
    // Ant 6.6's separator exposes ARIA values but has no keyboard resize handler.
    const separator = ref.current?.querySelector<HTMLElement>('[role="separator"]');
    if (!separator) return;
    separator.tabIndex = inline ? 0 : -1;
    separator.setAttribute('aria-label', '调整位置栏宽度');
    separator.setAttribute('aria-valuemin', String(minWidth));
    separator.setAttribute('aria-valuemax', String(max));
    separator.setAttribute('aria-valuenow', String(size));
    separator.setAttribute('aria-valuetext', `${Math.round(size)} 像素`);
    const keydown = (event: KeyboardEvent) => {
      const next =
        event.key === 'ArrowLeft'
          ? size - 8
          : event.key === 'ArrowRight'
            ? size + 8
            : event.key === 'Home'
              ? minWidth
              : event.key === 'End'
                ? max
                : undefined;
      if (next === undefined || !inline) return;
      event.preventDefault();
      onRemember(clamp(next, max));
    };
    separator.addEventListener('keydown', keydown);
    return () => separator.removeEventListener('keydown', keydown);
  }, [inline, size, max, onRemember]);
  return (
    <div ref={ref} className={`wb-inventory-columns${inline ? ' with-locations' : ''}`}>
      <Splitter
        style={{ height: 'auto' }}
        onResize={(sizes) => {
          if (inline) onResize(clamp(sizes[0], max));
        }}
        onResizeEnd={(sizes) => {
          if (inline) onRemember(clamp(sizes[0], max));
        }}
        onDraggerDoubleClick={() => onRemember(defaultWidth)}
      >
        <Splitter.Panel
          size={inline ? size : 0}
          min={inline ? minWidth : 0}
          max={inline ? max : 0}
          resizable={inline}
          className="wb-location-panel"
        >
          {inline && tree}
        </Splitter.Panel>
        <Splitter.Panel min={inline ? 656 : 0} className="wb-list-panel">
          {children}
        </Splitter.Panel>
      </Splitter>
    </div>
  );
}
