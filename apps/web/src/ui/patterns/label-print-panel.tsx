import type { ReactNode } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { InlineNotice } from '../components/ui/inline-notice';
import { CapabilityNotice } from './capability-notice';
import type { ActionAvailability } from './types';
import './operations.css';

export interface PrintLabelItem {
  id: string;
  name: string;
  labelText: string;
  preview?: ReactNode;
}
export type PrintPageStatus =
  'not-sent' | 'sending' | 'sent' | 'device-feedback' | 'paper-confirmed' | 'unknown' | 'failed';
export interface PrintPagePresentation {
  pageId: string;
  itemId: string;
  status: PrintPageStatus;
  detail?: string;
}
export interface LabelPrintPanelProps {
  selectedItemIds: readonly string[];
  items: readonly PrintLabelItem[];
  pages: readonly PrintPagePresentation[];
  deviceCapability: ActionAvailability;
  connection: 'disconnected' | 'connecting' | 'connected';
  deviceLabel?: string;
  onConnect: () => void;
  onPrintUnsent: (pageIds: readonly string[]) => void;
  onStop: () => void;
  onInspectPage: (pageId: string) => void;
  onConfirmPaper: (pageId: string) => void;
}
const pageLabels: Record<PrintPageStatus, string> = {
  'not-sent': '尚未发送',
  sending: '正在发送',
  sent: '已发送，出纸未确认',
  'device-feedback': '已收到设备反馈',
  'paper-confirmed': '已人工确认出纸',
  unknown: '出纸结果未知',
  failed: '发送失败',
};
export function LabelPrintPanel({
  selectedItemIds,
  items,
  pages,
  deviceCapability,
  connection,
  deviceLabel,
  onConnect,
  onPrintUnsent,
  onStop,
  onInspectPage,
  onConfirmPaper,
}: LabelPrintPanelProps) {
  const selected = new Set(selectedItemIds);
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const visiblePages = pages.filter((page) => selected.has(page.itemId));
  const missing =
    selectedItemIds.some((id) => !itemMap.has(id)) ||
    pages.some((page) => !selected.has(page.itemId));
  const sending = pages.some((page) => page.status === 'sending');
  const unknown = pages.some((page) => page.status === 'unknown');
  const unsent = visiblePages.filter((page) => page.status === 'not-sent');
  const canPrint =
    deviceCapability.kind === 'available' &&
    connection === 'connected' &&
    !sending &&
    !unknown &&
    !missing &&
    unsent.length > 0;
  return (
    <section className="vn-operation-card vn-stack" aria-label="标签打印">
      <div className="vn-operation-heading">
        <h3 className="vn-section-title">标签预览与逐页状态</h3>
        <Badge variant={connection === 'connected' ? 'info' : 'warning'}>
          {connection === 'connected'
            ? '已连接'
            : connection === 'connecting'
              ? '正在连接'
              : '未连接设备'}
        </Badge>
      </div>
      <p className="vn-operation-summary">
        {deviceLabel || '尚未提供设备名称'} · 已明确选择 {selectedItemIds.length} 件物品。
      </p>
      {deviceCapability.kind !== 'available' && (
        <CapabilityNotice capabilityLabel="标签打印" availability={deviceCapability} />
      )}
      {unknown && (
        <InlineNotice tone="warning" title="有页面结果未知，暂停后续发送">
          请先核对纸张。不会自动重印，也不把设备反馈当作已经出纸。
        </InlineNotice>
      )}
      {missing && (
        <InlineNotice tone="danger" title="打印范围与预览资料不一致">
          请重新核对明确选择的物品，当前不能发送。
        </InlineNotice>
      )}
      {!selectedItemIds.length && (
        <InlineNotice tone="info" title="还没有选择要打印的物品">
          先明确选择具体物品，再生成对应标签页。
        </InlineNotice>
      )}
      <ul className="vn-print-previews">
        {selectedItemIds.map((id) => {
          const item = itemMap.get(id);
          return (
            <li key={id} className="vn-print-label">
              <h4 className="vn-operation-subtitle">{item?.name || '物品预览资料缺失'}</h4>
              <code>{id}</code>
              <p>{item?.labelText}</p>
              {item?.preview && <div className="vn-print-artwork">{item.preview}</div>}
            </li>
          );
        })}
      </ul>
      <ol className="vn-operation-object-list">
        {visiblePages.map((page) => (
          <li key={page.pageId}>
            <div>
              <h4 className="vn-operation-subtitle">
                标签页 <code>{page.pageId}</code>
              </h4>
              <code>{page.itemId}</code>
              <Badge
                variant={
                  page.status === 'paper-confirmed'
                    ? 'success'
                    : page.status === 'unknown'
                      ? 'warning'
                      : page.status === 'failed'
                        ? 'danger'
                        : 'neutral'
                }
              >
                {pageLabels[page.status]}
              </Badge>
              {page.detail && <p className="vn-muted">{page.detail}</p>}
            </div>
            <div className="vn-operation-actions">
              {(page.status === 'unknown' || page.status === 'failed') && (
                <Button variant="secondary" onClick={() => onInspectPage(page.pageId)}>
                  核对这一页
                </Button>
              )}
              {(page.status === 'sent' ||
                page.status === 'device-feedback' ||
                page.status === 'unknown') && (
                <Button variant="quiet" onClick={() => onConfirmPaper(page.pageId)}>
                  我已看到正确纸张
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {selectedItemIds.length > 0 && !visiblePages.length && (
        <InlineNotice tone="info" title="尚未提供打印页">
          标签预览不代表已创建或已发送打印任务。
        </InlineNotice>
      )}
      <div className="vn-operation-actions">
        <Button
          variant="secondary"
          busy={connection === 'connecting'}
          disabled={deviceCapability.kind !== 'available' || connection === 'connected' || sending}
          onClick={onConnect}
        >
          连接设备
        </Button>
        <Button
          disabled={!canPrint}
          onClick={() => onPrintUnsent(unsent.map((page) => page.pageId))}
        >
          发送尚未发送的 {unsent.length} 页
        </Button>
        <Button variant="quiet" disabled={!sending} onClick={onStop}>
          停止后续发送
        </Button>
      </div>
      <p className="vn-muted">
        发送完成、设备反馈和人工确认纸张分别记录。停止不会撤回已经发送的页面。
      </p>
    </section>
  );
}
