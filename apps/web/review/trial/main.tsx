import { trialToday, setTrialDate } from './clock';
import { trialSubmitting } from './storage';
import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import {
  AcornaryThemeProvider,
  type AppearancePreset,
  type UIMode,
} from '../../src/ui/theme/provider';
import { ReviewAppearanceProvider } from '../appearance-context';
const SettingsJourney = lazy(() =>
  import('../pages/SettingsJourney').then((m) => ({ default: m.SettingsJourney })),
);
import { safePagePath } from '../pages/catalog';
import { PageJourney } from '../pages/PageJourney';
import { initializeTrialScope, getTrialScope, subscribeTrialScope, setTrialRole } from './session';
import { initializeTrialStorage, resetTrialStorage, storageNotice } from './storage';
import { Button } from '../../src/ui/components/ui/button';
import './trial.css';
function Trial() {
  const scope = useSyncExternalStore(subscribeTrialScope, getTrialScope);
  const [preset, setPreset] = useState<AppearancePreset>(() => {
    try {
      const saved = localStorage.getItem('trial-preset');
      return ['sage', 'apricot', 'berry', 'terracotta'].includes(saved || '')
        ? (saved as AppearancePreset)
        : 'sage';
    } catch {
      return 'sage';
    }
  });
  const [mode, setMode] = useState<UIMode>('daily');
  const [tools, setTools] = useState(false);
  const [scenario, setScenario] = useState('normal');
  const [error, setError] = useState('');
  const [reset, setReset] = useState(false);
  const [clockRevision, setClockRevision] = useState(0);
  return (
    <AcornaryThemeProvider preset={preset} mode={mode} className="trial-app">
      <ReviewAppearanceProvider
        value={{
          preset,
          mode,
          onPresetChange: (value) => {
            setPreset(value);
            try {
              localStorage.setItem('trial-preset', value);
            } catch {}
          },
          onModeChange: setMode,
        }}
      >
        <header className="trial-strip">
          <span>试用版 · 示例数据</span>
          <Button variant="quiet" onClick={() => setTools(!tools)}>
            试用工具
          </Button>
        </header>
        {tools && (
          <section className="trial-tools" aria-label="试用工具">
            <label>
              场景{' '}
              <select
                value={scenario}
                onChange={(e) => {
                  if (trialSubmitting()) setError('任务正在提交，请等待结果后切换场景。');
                  else {
                    setError('');
                    setScenario(e.target.value);
                  }
                }}
              >
                {[
                  ['normal', '正常'],
                  ['unknown', '结果不确定'],
                  ['conflict', '版本冲突'],
                  ['offline', '离线'],
                  ['forbidden', '无权限'],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              示例角色{' '}
              <select
                value={scope.role}
                onChange={(e) => {
                  try {
                    setTrialRole(e.target.value as typeof scope.role);
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                <option value="owner">所有者</option>
                <option value="member">成员</option>
                <option value="viewer">只读</option>
              </select>
            </label>
            <label>
              示例日期（上海）
              <input
                type="date"
                value={trialToday()}
                onChange={(e) => {
                  try {
                    setTrialDate(e.target.value);
                    setClockRevision((v) => v + 1);
                    setError('');
                  } catch (error) {
                    setError(String(error));
                  }
                }}
              />
            </label>
            <Button variant="secondary" onClick={() => setReset(true)}>
              重置试用数据
            </Button>
            {reset && (
              <div role="alert">
                <p>将清除两个示例家庭的库存修改、草稿及未决任务。已提交意见保留。</p>
                <Button onClick={() => void resetTrialStorage().catch((e) => setError(String(e)))}>
                  确认重置试用数据
                </Button>
                <Button variant="quiet" onClick={() => setReset(false)}>
                  取消
                </Button>
              </div>
            )}
            {error && <p role="alert">{error}</p>}
            {storageNotice && <p role="status">{storageNotice}</p>}
          </section>
        )}
        {storageNotice && (
          <p className="trial-storage-notice" role="status">
            {storageNotice}
          </p>
        )}
        <Suspense fallback={<p role="status">正在打开页面…</p>}>
          {!scope.signedIn ? (
            <SettingsJourney
              path="/settings/auth?view=login"
              scenario="login"
              navigate={(path) => {
                location.hash = safePagePath(path) || '/items';
              }}
            />
          ) : (
            <PageJourney
              key={`${scope.householdId}:${scope.generation}:${scenario}:${clockRevision}`}
              initialPath="/items"
              scenario={scenario}
            />
          )}
        </Suspense>
      </ReviewAppearanceProvider>
    </AcornaryThemeProvider>
  );
}
let disposed = false;
const root = createRoot(document.getElementById('root')!);
import.meta.hot?.dispose(() => {
  disposed = true;
  root.unmount();
});
initializeTrialScope();
if (!location.hash || location.hash === '#/') {
  try {
    const scope = getTrialScope();
    const mode = localStorage.getItem(`trial-mode:${scope.accountId}:${scope.householdId}`);
    location.hash = mode === 'management' ? '/manage/items' : '/items';
  } catch {
    location.hash = '/items';
  }
}
initializeTrialStorage()
  .then(() => {
    if (!disposed) root.render(<Trial />);
  })
  .catch((error) => {
    document.getElementById('root')!.textContent =
      `无法打开试用数据：${String(error)}。原数据已保留。`;
  });
