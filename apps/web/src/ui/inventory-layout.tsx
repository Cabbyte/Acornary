import { Splitter } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const defaultWidth = 224;
const minWidth = 180;
const maxWidth = 320;
const rememberedWidths = new Map<string, number>();
const clamp = (n: number, max = maxWidth) => Math.max(minWidth, Math.min(max, n));

export function useLocationPanelWidth(panel: 'location' | 'catalog' = 'location') {
  const widthKey = `acornary-${panel}-panel-width`;
  const [width, setWidth] = useState(() => {
    let rememberedWidth = rememberedWidths.get(widthKey) ?? defaultWidth;
    try {
      const saved = localStorage.getItem(widthKey);
      if (saved !== null && Number.isFinite(Number(saved))) rememberedWidth = clamp(Number(saved));
    } catch {
      // Opaque MCP iframes have no storage access. Retain the session preference in memory.
    }
    return rememberedWidth;
  });
  const remember = (value: number) => {
    const rememberedWidth = clamp(value);
    rememberedWidths.set(widthKey, rememberedWidth);
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
  resizeLabel = '调整位置栏宽度',
}: {
  inline: boolean;
  width: number;
  max: number;
  onResize: (width: number) => void;
  onRemember: (width: number) => void;
  tree: ReactNode;
  children: ReactNode;
  resizeLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = clamp(width, max);
  useEffect(() => {
    // Ant 6.6's separator exposes ARIA values but has no keyboard resize handler.
    const separator = ref.current?.querySelector<HTMLElement>('[role="separator"]');
    if (!separator) return;
    const attributes = {
      tabindex: inline ? '0' : '-1',
      'aria-label': resizeLabel,
      'aria-valuemin': String(minWidth),
      'aria-valuemax': String(max),
      'aria-valuenow': String(size),
      'aria-valuetext': `${Math.round(size)} 像素`,
    };
    const syncAria = () => {
      for (const [name, value] of Object.entries(attributes))
        if (separator.getAttribute(name) !== value) separator.setAttribute(name, value);
    };
    syncAria();
    // Splitter recalculates percentage ARIA values after its own ResizeObserver runs.
    // Keep the advertised bounds in pixels, matching our keyboard resize handler.
    const observer = new MutationObserver(syncAria);
    observer.observe(separator, { attributes: true, attributeFilter: Object.keys(attributes) });
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
    return () => {
      observer.disconnect();
      separator.removeEventListener('keydown', keydown);
    };
  }, [inline, size, max, onRemember, resizeLabel]);
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
