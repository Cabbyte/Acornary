import { useMemo } from 'react';
import { Button, Card, Select, Space, Tag } from 'antd';
import { Link, useLocation } from '@tanstack/react-router';
import { usePrinter } from '../lib/printer-context';
import { D101Printer } from '../lib/d101-printer';
import { LABEL_PROFILES } from '../lib/label-profiles';
import { renderLabel } from '../lib/label-renderer';
import { canPrintLabels, itemLabelURL } from '../lib/labels';
import { embeddedRuntime } from '../lib/runtime';
import { useSession } from '../lib/session';
import { FormField, Notice } from './components';

export default function PrinterSettings() {
  const location = useLocation();
  const returnTo = new URLSearchParams(location.searchStr).get('returnTo') ?? '';
  const returnURL =
    /^\/(items|catalog|places)(?:[/?]|$)/.test(returnTo) && !returnTo.includes('\\')
      ? new URL(returnTo, window.location.origin)
      : undefined;
  const { printer, size, density, connected, connecting, busy, name, error } = usePrinter();
  const { expired } = useSession();
  const supported = canPrintLabels() && !embeddedRuntime();
  const profile = LABEL_PROFILES[size];
  const preview = useMemo(() => {
    try {
      const url = itemLabelURL('item_11111111-1111-4111-8111-000000000001', window.location.origin);
      return { src: renderLabel('冷藏饮料', '计划吃完', '2026-10-15', url, profile).toDataURL() };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }, [profile]);
  return (
    <>
      <header className="page-header">
        <Link to="/settings">‹ 设置</Link>
        <h1>打印机与标签</h1>
      </header>
      <div className="content stack">
        <Card className="card" title="打印机">
          <div className="stack">
            <Space wrap>
              <strong>{name || 'NIIMBOT D101'}</strong>
              <Tag color={connected ? 'green' : undefined}>
                {connecting ? '正在连接' : connected ? '已连接' : '未连接'}
              </Tag>
            </Space>
            {!supported && <Notice>请在 Mac 的 Chrome 独立网页中配对和连接打印机。</Notice>}
            <Space wrap>
              <Button
                type="primary"
                disabled={!supported || expired || connecting || busy || connected}
                loading={connecting}
                onClick={() =>
                  void printer.connect((disconnected) => new D101Printer(disconnected))
                }
              >
                {name ? '重新连接' : '配对并连接 D101'}
              </Button>
              {connected && (
                <Button disabled={busy} onClick={() => void printer.disconnect()}>
                  断开连接
                </Button>
              )}
              {name && (
                <Button
                  disabled={!supported || expired || busy || connecting}
                  onClick={() =>
                    void printer.connect((disconnected) => new D101Printer(disconnected), true)
                  }
                >
                  更换打印机
                </Button>
              )}
            </Space>
            <small>
              连接后，打开物品的“打印标签”即可预览和打印。关闭预览不会断开连接；刷新网页后可能需要重新配对。
            </small>
            {busy && <Notice>正在打印，请等待当前批次完成后更改设置。</Notice>}
            {error && <Notice danger>{error}</Notice>}
          </div>
        </Card>
        <Card className="card" title="标签纸与样式">
          <div className="stack">
            <FormField label="标签尺寸">
              <Select
                value={size}
                disabled={busy}
                onChange={(size) => printer.configure({ size })}
                options={Object.values(LABEL_PROFILES).map((p) => ({ value: p.id, label: p.name }))}
              />
            </FormField>
            <FormField label="打印浓度">
              <Select
                value={density}
                disabled={busy}
                onChange={(density) => printer.configure({ density })}
                options={[1, 2, 3].map((v) => ({
                  value: v,
                  label: `${v}${v === 2 ? '（默认）' : ''}`,
                }))}
              />
            </FormField>
            <p>默认样式：{profile.layout}</p>
            <p>请装入与所选尺寸一致的标签纸。换纸后先打印一张，检查边距和扫码效果。</p>
            {preview.src && (
              <img
                className="label-preview"
                width={profile.width}
                height={profile.height}
                src={preview.src}
                alt={`${profile.name}标签样式示例`}
              />
            )}
            {preview.error && <Notice danger>{preview.error}</Notice>}
            <small>
              这是样式示例，二维码不对应库存物品。设置保存在当前浏览器，预览为放大显示。
            </small>
          </div>
        </Card>
        {returnURL ? (
          <Link to={returnURL.pathname} search={Object.fromEntries(returnURL.searchParams)}>
            返回标签预览
          </Link>
        ) : (
          <Link to="/items">返回我的物品</Link>
        )}
      </div>
    </>
  );
}
