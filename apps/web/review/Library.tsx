import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AcornaryThemeProvider,
  type AppearancePreset,
  type UIMode,
} from '../src/ui/theme/provider';
import source from '../src/ui/tokens/source.json';
import { entries } from './registry';
import reviewStatus from './review-status.json';
import type { ReviewEntry } from './types';
import './library.css';
import { ReviewAppearanceProvider } from './appearance-context';
import { FeedbackPanel } from './feedback/FeedbackPanel';
import { ReviewFrame } from './review-frame';
const presets = Object.keys(source.presets) as AppearancePreset[];
const widths = [360, 390, 768, 1024, 1440, 1920];
const initial = new URLSearchParams(location.search);
const validPreset = (v: string | null): AppearancePreset =>
  presets.includes(v as AppearancePreset) ? (v as AppearancePreset) : 'sage';
export function Library() {
  const [id, setId] = useState(initial.get('component') || entries[0]?.id || 'button');
  const [preset, setPreset] = useState<AppearancePreset>(validPreset(initial.get('preset')));
  const [mode, setMode] = useState<UIMode>(
    initial.get('mode') === 'management' ? 'management' : 'daily',
  );
  const [scenario, setScenario] = useState(initial.get('scenario') || 'normal');
  const [width, setWidth] = useState(
    widths.includes(Number(initial.get('viewport'))) ? Number(initial.get('viewport')) : 390,
  );
  const [search, setSearch] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [frameHeight, setFrameHeight] = useState(560);
  const [available, setAvailable] = useState(0);
  const [pageLocation, setPageLocation] = useState<{ id: string; route: string } | null>(null);
  const [navigationEpoch, setNavigationEpoch] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
    main.current?.focus({ preventScroll: true });
  }, [id, scenario]);
  const entry = entries.find((e) => e.id === id) || entries[0];
  const activeScenario =
    entry?.scenarios.find((s) => s.id === scenario)?.id || entry?.scenarios[0]?.id || 'normal';
  const embedded = initial.get('embed') === '1';
  const frameRoute = useMemo(
    () => (navigationEpoch === 0 && id === initial.get('component') ? initial.get('route') : null),
    [id, navigationEpoch],
  );
  const displayedEntry =
    entry?.kind === 'page' && pageLocation
      ? entries.find((candidate) => candidate.id === pageLocation.id) || entry
      : entry;
  useEffect(() => {
    setPageLocation(null);
    if (entry?.kind === 'page')
      setMode(entry.id.startsWith('page-manage-') ? 'management' : 'daily');
  }, [id, activeScenario, navigationEpoch, entry?.kind]);
  useEffect(() => {
    const params = new URLSearchParams({
      component: entry?.id || id,
      preset,
      mode,
      viewport: String(width),
      scenario: activeScenario,
    });
    if (embedded) params.set('embed', '1');
    if (entry?.kind === 'page' && (pageLocation?.route || frameRoute))
      params.set('route', pageLocation?.route || frameRoute!);
    history.replaceState(history.state, '', `?${params}${location.hash}`);
    frame.current?.contentWindow?.postMessage(
      { kind: 'acornary-review-theme', preset, mode },
      location.origin,
    );
  }, [
    id,
    preset,
    mode,
    width,
    activeScenario,
    entry?.id,
    entry?.kind,
    embedded,
    pageLocation,
    frameRoute,
  ]);
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== location.origin) return;
      if (embedded && event.source === parent && event.data?.kind === 'acornary-review-theme') {
        setPreset(validPreset(event.data.preset));
        setMode(event.data.mode === 'management' ? 'management' : 'daily');
      } else if (
        !embedded &&
        event.source === frame.current?.contentWindow &&
        event.data?.kind === 'acornary-review-page'
      ) {
        if (entries.some((entry) => entry.kind === 'page' && entry.id === event.data.id))
          setPageLocation({ id: event.data.id, route: String(event.data.route) });
      } else if (
        !embedded &&
        event.source === frame.current?.contentWindow &&
        event.data?.kind === 'acornary-review-appearance-intent'
      ) {
        setPreset(validPreset(event.data.preset));
        setMode(event.data.mode === 'management' ? 'management' : 'daily');
      } else if (
        !embedded &&
        event.source === frame.current?.contentWindow &&
        event.data?.kind === 'acornary-review-height'
      ) {
        setFrameHeight(Math.min(3000, Math.max(360, Number(event.data.height) || 560)));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [embedded]);
  useEffect(() => {
    if (!embedded) return;
    const observer = new ResizeObserver(() =>
      parent.postMessage(
        {
          kind: 'acornary-review-height',
          height:
            entry?.kind === 'page'
              ? Math.ceil(
                  document.getElementById('review-embed')?.getBoundingClientRect().height || 560,
                )
              : document.getElementById('review-embed')?.scrollHeight || 560,
        },
        location.origin,
      ),
    );
    observer.observe(
      entry?.kind === 'page'
        ? document.getElementById('review-embed') || document.body
        : document.body,
    );
    return () => observer.disconnect();
  }, [embedded, entry?.kind]);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([r]) => setAvailable(Math.floor(r.contentRect.width)));
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  if (!entry) return <p>组件目录尚在整合。</p>;
  const Demo = entry.component;
  if (embedded)
    return (
      <AcornaryThemeProvider preset={preset} mode={mode}>
        <div id="review-embed" className="review-embed">
          <ReviewAppearanceProvider
            value={{
              preset,
              mode,
              onPresetChange: (next) => {
                setPreset(next);
                if (parent !== window)
                  parent.postMessage(
                    { kind: 'acornary-review-appearance-intent', preset: next, mode },
                    location.origin,
                  );
              },
              onModeChange: (next) => {
                setMode(next);
                if (parent !== window)
                  parent.postMessage(
                    { kind: 'acornary-review-appearance-intent', preset, mode: next },
                    location.origin,
                  );
              },
            }}
          >
            {parent === window && entry.kind !== 'page' && (
              <FeedbackPanel
                context={{
                  component: entry.id,
                  name: entry.name,
                  scenario: activeScenario,
                  preset,
                  mode,
                  viewport: window.innerWidth,
                  version: entry.version || reviewStatus.version,
                }}
              />
            )}
            <ReviewFrame>
              <Demo scenario={activeScenario} />
            </ReviewFrame>
          </ReviewAppearanceProvider>
        </div>
      </AcornaryThemeProvider>
    );
  const grouped = entries
    .filter((e) => `${e.name} ${e.id}`.toLowerCase().includes(search.toLowerCase()))
    .reduce<Record<string, ReviewEntry[]>>((groups, e) => {
      (groups[e.group] ??= []).push(e);
      return groups;
    }, {});
  const link = `?component=${encodeURIComponent(entry.id)}&scenario=${encodeURIComponent(activeScenario)}&embed=1${frameRoute ? `&route=${encodeURIComponent(frameRoute)}` : ''}`;
  const standaloneLink =
    entry.kind === 'page' && pageLocation
      ? `?component=${pageLocation.id}&scenario=${activeScenario}&embed=1&route=${encodeURIComponent(pageLocation.route)}`
      : link;
  const actual = Math.min(width, available || width);
  return (
    <AcornaryThemeProvider preset={preset} mode={mode}>
      <div className="library">
        <header className="library-header">
          <div>
            <strong>Acornary</strong>
            <span>组件与页面审阅</span>
          </div>
          <span className="library-meta">
            {reviewStatus.version} 组件已确认 · 页面{' '}
            {entries.filter((e) => e.kind === 'page' && e.status === '已批准').length}/
            {entries.filter((e) => e.kind === 'page').length} 已确认
          </span>
        </header>
        <div className="library-layout">
          <aside className="library-sidebar" data-open={catalogOpen || Boolean(search)}>
            <button
              type="button"
              className="library-directory-toggle"
              aria-expanded={catalogOpen || Boolean(search)}
              aria-controls="review-directory"
              onClick={() => {
                setCatalogOpen(!catalogOpen);
                if (catalogOpen) setSearch('');
              }}
            >
              {catalogOpen ? '收起组件目录' : `浏览 ${entries.length} 项设计候选`}
            </button>
            <label className="library-label">
              查找组件或页面
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="名称或组件 ID"
              />
            </label>
            <nav id="review-directory" aria-label="审阅目录">
              {Object.entries(grouped).map(([group, list]) => (
                <details key={group} open>
                  <summary>{group}</summary>
                  {list?.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      aria-current={e.id === displayedEntry?.id ? 'page' : undefined}
                      onClick={() => {
                        setId(e.id);
                        setNavigationEpoch((value) => value + 1);
                        setCatalogOpen(false);
                        setSearch('');
                        setScenario(e.scenarios[0]?.id || 'normal');
                      }}
                    >
                      {e.name}
                    </button>
                  ))}
                </details>
              ))}
            </nav>
          </aside>
          <main ref={main} tabIndex={-1} className="library-main">
            <div className="library-title">
              <div>
                <h1>{displayedEntry?.name}</h1>
                <p>{displayedEntry?.description}</p>
              </div>
              <span className="review-badge">
                {displayedEntry?.status === '待审阅' ? '待用户审阅' : displayedEntry?.status}
              </span>
            </div>
            <div className="library-controls">
              <label>
                配色
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as AppearancePreset)}
                >
                  {presets.map((p) => (
                    <option key={p} value={p}>
                      {source.presets[p].name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                模式
                <select
                  value={mode}
                  disabled={entry.kind === 'page'}
                  title={
                    entry.kind === 'page' ? '页面模式由当前路由决定，可在页面内切换' : undefined
                  }
                  onChange={(e) => setMode(e.target.value as UIMode)}
                >
                  <option value="daily">日常</option>
                  <option value="management">管理</option>
                </select>
              </label>
              <label>
                目标宽度
                <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
                  {widths.map((w) => (
                    <option key={w} value={w}>
                      {w} px
                    </option>
                  ))}
                </select>
              </label>
              <label>
                场景
                <select value={activeScenario} onChange={(e) => setScenario(e.target.value)}>
                  {entry.scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="library-preview-bar">
              <span>
                示例数据 · 实际容器 {actual} px{actual < width ? '（受当前窗口限制）' : ''}
              </span>
              <a
                href={`${standaloneLink}&preset=${preset}&mode=${mode}&viewport=${width}`}
                target="_blank"
                rel="noreferrer"
              >
                独立打开
              </a>
              <a
                href={`http://127.0.0.1:6006/?path=/story/${displayedEntry?.storyId || `components-${entry.id}--default`}`}
                target="_blank"
                rel="noreferrer"
              >
                Storybook
              </a>
            </div>
            {entry.kind !== 'page' && (
              <FeedbackPanel
                context={{
                  component: entry.id,
                  name: entry.name,
                  scenario: activeScenario,
                  preset,
                  mode,
                  viewport: actual,
                  version: entry.version || reviewStatus.version,
                }}
              />
            )}
            <div ref={stage} className="library-stage">
              <iframe
                ref={frame}
                key={`${entry.id}:${activeScenario}:${navigationEpoch}`}
                title={`${entry.name}预览`}
                src={link}
                onLoad={() =>
                  frame.current?.contentWindow?.postMessage(
                    { kind: 'acornary-review-theme', preset, mode },
                    location.origin,
                  )
                }
                style={{ width: `min(100%, ${width}px)`, height: frameHeight }}
              />
            </div>
            <details className="library-notes">
              <summary>审阅说明与边界</summary>
              <p>
                反馈时注明组件名称、配色、模式和场景。演示操作只改变隔离预览，不连接家庭、库存或设备。切换配色和模式保留当前输入。
              </p>
              <p>{entry.limitations || '尚未完成业务接线、完整回归及真实 MCP/设备验收。'}</p>
              <code>
                {displayedEntry?.id} · {displayedEntry?.version || reviewStatus.version}
              </code>
            </details>
          </main>
        </div>
      </div>
    </AcornaryThemeProvider>
  );
}
