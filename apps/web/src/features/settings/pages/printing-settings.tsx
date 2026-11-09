import { Printer } from 'lucide-react';
import { Button } from '../../../ui/components/ui/button';
import { Select } from '../../../ui/components/ui/select';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import { SettingsFacts, SettingsLayout, SettingsSection } from './settings-layout';
import type { PrinterPreferences, PrinterState, SettingsPageProps, TestPrintState } from './models';
export interface PrintingSettingsPageProps extends SettingsPageProps {
  device: PrinterState;
  draft: PrinterPreferences;
  saved: PrinterPreferences;
  printState: TestPrintState;
  onChange: (value: PrinterPreferences) => void;
  onSave: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onPrint: () => void;
  onPrintResult: (success: boolean) => void;
}
export function PrintingSettingsPage(props: PrintingSettingsPageProps) {
  const { device, draft, saved, printState } = props;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  return (
    <SettingsLayout {...props} title="打印机与标签">
      <SettingsSection title="D101 标签打印机">
        <SettingsFacts
          values={[
            {
              label: '设备状态',
              value: {
                disconnected: '未连接',
                unavailable: '当前环境不支持设备连接',
                connected: '已连接 · 模拟状态',
              }[device],
            },
            { label: '连接方式', value: '支持 Web Bluetooth 的环境，需由用户主动连接' },
          ]}
        />
        <InlineNotice title="设备交互为隔离演示">
          本页不会打开蓝牙、搜索设备或发送真实打印任务。设备连通不能证明标签已出纸。
        </InlineNotice>
        <div className="vn-settings-actions">
          <Button
            variant="secondary"
            disabled={device === 'unavailable'}
            onClick={device === 'connected' ? props.onDisconnect : props.onConnect}
          >
            {device === 'connected' ? '断开示例连接' : '模拟连接设备'}
          </Button>
          {device === 'unavailable' && (
            <Button variant="secondary" onClick={() => props.navigate('/settings/auth?view=host')}>
              查看环境与连接
            </Button>
          )}
        </div>
        {device === 'unavailable' && (
          <p className="vn-settings-muted">
            宿主内嵌页面或不支持 Web Bluetooth
            的浏览器无法连接。请在支持的浏览器或设备环境中打开实际打印页面。
          </p>
        )}
      </SettingsSection>
      <SettingsSection
        title="标签设置"
        description="保存只作用于本次预览。纸型与浓度改变后，重新检查预览再试打。"
      >
        <div className="vn-settings-fields">
          <Select
            label="标签纸"
            value={draft.paper}
            disabled={printState === 'sent'}
            options={[
              { value: '40x30', label: '40 × 30 mm' },
              { value: '50x30', label: '50 × 30 mm' },
            ]}
            onValueChange={(value) => {
              if (value) props.onChange({ ...draft, paper: value as PrinterPreferences['paper'] });
            }}
          />
          <Select
            label="打印浓度"
            value={draft.density}
            disabled={printState === 'sent'}
            options={[
              { value: '1', label: '浅' },
              { value: '2', label: '标准' },
              { value: '3', label: '深' },
            ]}
            onValueChange={(value) => {
              if (value)
                props.onChange({ ...draft, density: value as PrinterPreferences['density'] });
            }}
          />
          <Select
            label="试打份数"
            value={draft.copies}
            disabled={printState === 'sent'}
            options={[
              { value: '1', label: '1 张' },
              { value: '2', label: '2 张' },
              { value: '3', label: '3 张' },
            ]}
            onValueChange={(value) => {
              if (value)
                props.onChange({ ...draft, copies: value as PrinterPreferences['copies'] });
            }}
          />
        </div>
        <Button disabled={!dirty || printState === 'sent'} onClick={props.onSave}>
          {dirty ? '保存标签设置' : '设置已保存'}
        </Button>
      </SettingsSection>
      <SettingsSection title="试打预览">
        <div className="vn-settings-label-preview">
          <Printer size={22} aria-hidden="true" />
          <strong>松仓 · 测试标签</strong>
          <span>示例标签 · 无实物绑定</span>
          <small>
            {draft.paper.replace('x', ' × ')} mm · {draft.copies} 张 · 浓度 {draft.density}
          </small>
        </div>
        <Button
          disabled={device !== 'connected' || dirty || printState === 'sent'}
          onClick={props.onPrint}
        >
          模拟试打 {saved.copies} 张
        </Button>
        {dirty && <p className="vn-settings-muted">先保存当前设置，再开始试打。</p>}
        {device === 'disconnected' && (
          <p className="vn-settings-muted">先连接示例设备再查看试打状态。</p>
        )}
        {printState === 'sent' && (
          <InlineNotice
            tone="warning"
            title="任务已发送，出纸结果待确认"
            action={
              <div className="vn-settings-actions">
                <Button variant="secondary" onClick={() => props.onPrintResult(true)}>
                  模拟全部出纸
                </Button>
                <Button variant="secondary" onClick={() => props.onPrintResult(false)}>
                  模拟未出纸
                </Button>
              </div>
            }
          >
            已发送的任务无法撤回；断开连接不会把它标记为成功。先核对本次结果，避免重复打印。
          </InlineNotice>
        )}
        {printState === 'confirmed' && (
          <InlineNotice tone="success" title={`已确认 ${saved.copies} 张示例标签完成`}>
            这是状态演示，不代表真实打印机已出纸。
          </InlineNotice>
        )}
        {printState === 'failed' && (
          <InlineNotice tone="warning" title="示例试打未出纸">
            请检查纸张和连接，然后可以重新试打。真实任务需先核对已出纸数量。
          </InlineNotice>
        )}
      </SettingsSection>
    </SettingsLayout>
  );
}
