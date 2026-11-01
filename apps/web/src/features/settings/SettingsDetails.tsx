import { lazy, Suspense, useState } from 'react';
import { Button, Card } from 'antd';
import appIcon from '../../../public/app-icon.png';
import { AccountSettings, HouseholdSettings } from '../../accounts';
import { useSession } from '../../lib/session';
import { useInventory } from '../../lib/inventory';
import { time } from '../../lib/presentation';
import { Notice, Row, ActionDrawer } from '../../ui/components';
const PrinterSettings = lazy(() => import('../../ui/printer-settings'));

export function SettingsDetails({ section }: { section?: string }) {
  const { session, online, logout, storageError } = useSession();
  const { data, refresh, cacheWarning } = useInventory();
  const [install, setInstall] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (session.host === 'mcp')
    return (
      <>
        <header className="page-header large"><h1>设置</h1><p>松仓 · {data.household.name}</p></header>
        <div className="content stack">
          <Notice>{session.can_write ? '当前连接可查看和修改库存。' : '当前连接只有读取权限。'}</Notice>
          <p>账号、家庭和连接授权请在松仓网站及 ChatGPT 插件设置中管理。</p>
          <p>草稿保存在当前组件的宿主状态中；新对话或其他设备不保证恢复。</p>
          <Button onClick={() => void refresh().catch(() => setError('更新失败，请重试。'))} htmlType="button" type="primary">刷新库存</Button>
          {error && <Notice danger>{error}</Notice>}
        </div>
      </>
    );
  if (section === 'printer')
    return <Suspense fallback={<p role="status">正在打开打印设置…</p>}><PrinterSettings /></Suspense>;
  if (session.mode === 'cloud' && (section === 'account' || section === 'households'))
    return (
      <>
        <header className="page-header"><a href="/settings">‹ 设置</a><h1>{section === 'account' ? '账号与安全' : '家庭'}</h1></header>
        <div className="content">{section === 'account' ? <AccountSettings /> : <HouseholdSettings />}</div>
      </>
    );
  return (
    <>
      <header className="page-header large"><h1>设置</h1><p>松仓 · 家里的每一件，都有迹可循</p></header>
      <div className="content">
        <Card className="card brand-card">
          <img src={appIcon} alt="松仓" width="56" height="56" />
          <div><h2>{data.household.name}</h2><p>{session.email ?? '本地所有者'}</p></div>
        </Card>
        {session.mode === 'cloud' && (
          <>
            <p className="section-label">账号与家庭</p>
            <div className="grouped">
              <Row title="账号与安全" subtitle="通行密钥、密码与身份验证" to="/settings/account" />
              <Row title="家庭" subtitle="成员、邀请与家庭切换" to="/settings/households" />
            </div>
          </>
        )}
        <p className="section-label">打印</p>
        <div className="grouped"><Row title="打印机与标签" subtitle="D101 蓝牙连接、标签尺寸与打印浓度" to="/settings/printer" /></div>
        <p className="section-label">本机缓存</p>
        <div className="grouped">
          <Row title="上次更新" detail={time(data.cached_at)} />
          <Row title="缓存范围" subtitle={`${data.catalog.length} 条目录、${data.items.length} 件实物；历史仅缓存打开过的最近记录。`} />
          <Row title="添加到主屏幕" subtitle="像 App 一样打开松仓" onClick={() => setInstall(true)} />
        </div>
        <Button disabled={!online || busy} onClick={async () => { setBusy(true); try { await refresh(); setError(''); } catch { setError('更新失败，请检查连接后重试。'); } finally { setBusy(false); } }} htmlType="button" type="default">{busy ? '正在更新…' : '更新缓存'}</Button>
        {(storageError || cacheWarning) && <Notice danger>{storageError || cacheWarning}</Notice>}
        {error && <Notice danger>{error}</Notice>}
        {session.mode === 'cloud' && (
          <Button disabled={!online || busy} onClick={async () => { setBusy(true); try { await logout(); } catch { setError('退出失败，请联网后重试。'); setBusy(false); } }} htmlType="button" type="primary" danger>退出登录并清除本机缓存</Button>
        )}
        <p className="section-label">开发者工具</p>
        <a className="button secondary" href="/inspect">数据库检查器</a>
        <small>在线查看原始记录、关联与历史。修正库存请使用松仓的业务操作。</small>
        <small>离线可查看缓存内容，修改需要联网。缓存可能由浏览器清理，不替代云端库存。</small>
        {install && (
          <ActionDrawer title="添加到主屏幕" onClose={() => setInstall(false)}>
            <ol className="instructions">
              <li>在 iPhone 的 Safari 中打开松仓。</li>
              <li>打开页面菜单，轻点“分享”。</li>
              <li>选择“添加到主屏幕”。</li>
              <li>打开“作为 Web App 打开”，然后轻点“添加”。</li>
            </ol>
            <p>以后可以从主屏幕上的松鼠图标直接进入。</p>
            <a className="button secondary" href="https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios" target="_blank" rel="noreferrer">查看 Apple 操作指引</a>
            <Button onClick={() => setInstall(false)} htmlType="button" type="primary">知道了</Button>
          </ActionDrawer>
        )}
      </div>
    </>
  );
}
