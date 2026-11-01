import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useInventory } from '../../lib/inventory.js';
import { useSession } from '../../lib/session.js';
import { time } from '../../lib/presentation.js';
import { isContainer } from '../../../../../packages/contracts/src/web.js';
import { Button, PageHeader, Section, Sheet } from '../../ui/primitives/index.js';
import styles from './SettingsScreen.module.css';

export function SettingsScreen() {
  const { session, online, logout, storageError } = useSession();
  const { data, refresh, cacheWarning } = useInventory();
  const [install, setInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const physicalCount = data.items.filter((item) => !isContainer(item)).length;

  async function updateCache() {
    setBusy(true);
    setError('');
    try {
      await refresh();
    } catch {
      setError('更新失败，请检查连接后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader title="设置" subtitle={`松仓 · ${data.household.name}`} />

      {session.host === 'mcp' ? (
        <Section title="当前连接">
          <p className={styles.hint}>
            {session.can_write ? '当前连接可查看和修改库存。' : '当前连接只有读取权限。'}
          </p>
          <p className={styles.hint}>账号、家庭和连接授权请在松仓网站及 ChatGPT 插件设置中管理。</p>
          <Button variant="secondary" onClick={() => void updateCache()} loading={busy}>
            刷新库存
          </Button>
        </Section>
      ) : (
        <>
          <Section title="家庭">
            <div className={styles.rows}>
              <div className={styles.row}>
                <div>
                  <strong>{data.household.name}</strong>
                  <p className={styles.hint}>{session.email ?? '本地所有者'}</p>
                </div>
              </div>
              {session.mode === 'cloud' && (
                <>
                  <Link to="/settings/account" search={{ ui: 'next' }} className={styles.row}>
                    <div>
                      <strong>账号与安全</strong>
                      <p className={styles.hint}>通行密钥、密码与身份验证</p>
                    </div>
                    <span aria-hidden="true">›</span>
                  </Link>
                  <Link to="/settings/households" search={{ ui: 'next' }} className={styles.row}>
                    <div>
                      <strong>家庭与成员</strong>
                      <p className={styles.hint}>邀请成员、切换家庭</p>
                    </div>
                    <span aria-hidden="true">›</span>
                  </Link>
                </>
              )}
            </div>
          </Section>

          <Section title="打印">
            <Link to="/settings/printer" search={{ ui: 'next' }} className={styles.row}>
              <div>
                <strong>打印机与标签</strong>
                <p className={styles.hint}>D101 蓝牙连接、标签尺寸与打印浓度</p>
              </div>
              <span aria-hidden="true">›</span>
            </Link>
          </Section>

          <Section title="本机缓存">
            <div className={styles.rows}>
              <div className={styles.row}>
                <div>
                  <strong>上次更新</strong>
                  <p className={styles.hint}>{time(data.cached_at)}</p>
                </div>
              </div>
              <div className={styles.row}>
                <div>
                  <strong>缓存范围</strong>
                  <p className={styles.hint}>
                    {data.catalog.length} 条目录、{physicalCount} 件物品
                  </p>
                </div>
              </div>
              <div className={styles.row}>
                <div>
                  <strong>添加到主屏幕</strong>
                  <p className={styles.hint}>像 App 一样打开松仓</p>
                </div>
                <Button variant="quiet" onClick={() => setInstall(true)}>
                  查看步骤
                </Button>
              </div>
            </div>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => void updateCache()} loading={busy}>
                更新缓存
              </Button>
              {session.mode === 'cloud' && (
                <Button
                  variant="danger"
                  disabled={!online || busy}
                  onClick={() => {
                    setBusy(true);
                    void logout().catch(() => {
                      setError('退出失败，请联网后重试。');
                      setBusy(false);
                    });
                  }}
                >
                  退出登录
                </Button>
              )}
            </div>
            {(storageError || cacheWarning || error) && (
              <p className={styles.error} role="alert">
                {error || storageError || cacheWarning}
              </p>
            )}
          </Section>
        </>
      )}

      <Section title="开发者工具">
        <div className={styles.rows}>
          <a className={styles.row} href="/inspect">
            <div>
              <strong>数据库检查器</strong>
              <p className={styles.hint}>只读查看原始记录、关联与历史</p>
            </div>
            <span aria-hidden="true">›</span>
          </a>
        </div>
      </Section>

      {install && (
        <Sheet
          title="添加到主屏幕"
          onClose={() => setInstall(false)}
          footer={
            <Button variant="primary" onClick={() => setInstall(false)}>
              知道了
            </Button>
          }
        >
          <ol className={styles.instructions}>
            <li>在 iPhone 的 Safari 中打开松仓。</li>
            <li>打开页面菜单，轻点“分享”。</li>
            <li>选择“添加到主屏幕”。</li>
            <li>打开“作为 Web App 打开”，然后轻点“添加”。</li>
          </ol>
          <p className={styles.hint}>以后可以从主屏幕上的松鼠图标直接进入。</p>
        </Sheet>
      )}
    </div>
  );
}
