import type { App } from '@modelcontextprotocol/ext-apps';

type HostContext = NonNullable<ReturnType<App['getHostContext']>>;
const finiteSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const pageScrollRoot = () =>
  document.documentElement.dataset.pluginLayout
    ? document.querySelector<HTMLElement>('.ant-app')
    : null;
export const readPageScroll = () => pageScrollRoot()?.scrollTop ?? window.scrollY;
export const setPageScroll = (top: number) => (pageScrollRoot() ?? window).scrollTo(0, top);

/** Partial host notifications must not reset bounds that were not included. */
export function applyHostLayout(context?: HostContext) {
  const root = document.documentElement;
  root.dataset.pluginLayout = 'true';
  if (context?.theme) root.dataset.hostTheme = context.theme;
  if (context?.safeAreaInsets) {
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const value = context.safeAreaInsets[edge];
      if (finiteSize(value)) root.style.setProperty(`--ac-host-${edge}`, `${value}px`);
    }
  }
  const bounds = context?.containerDimensions;
  if (bounds && ('height' in bounds || 'maxHeight' in bounds)) {
    const height = 'height' in bounds ? bounds.height : bounds.maxHeight;
    if (finiteSize(height)) root.style.setProperty('--ac-host-height', `${height}px`);
    else root.style.removeProperty('--ac-host-height');
  }
}

/** Shared by fixed navigation and every drawer, including when a keyboard opens. */
export function trackVisualViewport() {
  const viewport = window.visualViewport;
  const update = () => {
    document.documentElement.style.setProperty(
      '--ac-visual-height',
      `${viewport?.height ?? window.innerHeight}px`,
    );
  };
  update();
  viewport?.addEventListener('resize', update);
  window.addEventListener('resize', update);
  return () => {
    viewport?.removeEventListener('resize', update);
    window.removeEventListener('resize', update);
  };
}
