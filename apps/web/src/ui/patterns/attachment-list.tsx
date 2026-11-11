import { FileText, Paperclip } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { InlineNotice } from '../components/ui/inline-notice';
import { CapabilityNotice } from './capability-notice';
import { EmptyState } from './empty-state';
import { LoadingState } from './loading-state';
import type { ActionAvailability, AttachmentView } from './types';
import { cn } from '../components/utils';
import './content.css';

/** Read-only presentation metadata, kept separate from the AttachmentView contract. */
export interface AttachmentPresentation {
  name?: string;
  state?: 'ready' | 'pending' | 'restricted' | 'unknown' | 'failed';
  reason?: string;
  url?: string;
}
export interface AttachmentListProps {
  attachments: readonly AttachmentView[];
  presentations?: Readonly<Record<string, AttachmentPresentation>>;
  state?: 'ready' | 'loading' | 'error' | 'unknown' | 'denied';
  error?: string;
  readOnly?: boolean;
  removeAvailability?: ActionAvailability;
  onOpen?: (attachment: AttachmentView, suppliedUrl?: string) => void;
  onRemove?: (attachment: AttachmentView) => void;
  onRetry?: () => void;
  className?: string;
}
function sizeLabel(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '大小未知';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
const attachmentStates = {
  ready: '可查看',
  pending: '处理中',
  restricted: '内容不可见',
  unknown: '状态未知',
  failed: '处理失败',
};

/** Rendering and intents only: never creates URLs, loads file bytes or starts a transfer. */
export function AttachmentList({
  attachments,
  presentations = {},
  state = 'ready',
  error,
  readOnly,
  removeAvailability,
  onOpen,
  onRemove,
  onRetry,
  className,
}: AttachmentListProps) {
  if (state === 'loading') return <LoadingState className={className} label="正在读取附件" />;
  if (state === 'denied')
    return (
      <CapabilityNotice
        capabilityLabel="查看附件"
        availability={{
          kind: 'forbidden',
          reason: error || '当前权限不允许查看附件，附件数量未知。',
        }}
      />
    );
  const unknown = state === 'error' || state === 'unknown';
  const removal =
    removeAvailability ??
    ({
      kind: 'missingContract',
      reason: '当前入口未提供移除附件的能力。',
    } satisfies ActionAvailability);
  return (
    <section className={cn('vn-stack', className)} aria-label="附件列表">
      {unknown && (
        <InlineNotice
          tone={state === 'error' ? 'danger' : 'warning'}
          title={state === 'error' ? '附件读取失败' : '附件状态尚未确认'}
          action={
            onRetry && (
              <Button variant="secondary" onClick={onRetry}>
                刷新列表
              </Button>
            )
          }
        >
          {error || '暂不能确认完整附件列表。'}
          {attachments.length > 0 && '下方保留已取得的附件。'}
        </InlineNotice>
      )}
      {readOnly && <p className="vn-content-meta">附件只读</p>}
      {onRemove && !readOnly && removal.kind !== 'available' && (
        <CapabilityNotice capabilityLabel="移除附件" availability={removal} />
      )}
      {!attachments.length && !unknown ? (
        <EmptyState reason="empty" title="还没有附件" context="可以为此记录添加照片或文档。" />
      ) : (
        <ul className="vn-attachment-list">
          {[...attachments]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((attachment) => {
              const presentation = presentations[attachment.id];
              const itemState = presentation?.state ?? 'ready';
              const restricted = itemState === 'restricted';
              const name = restricted
                ? '受限附件'
                : presentation?.name || attachment.caption || '未命名附件';
              const ready = itemState === 'ready';
              const Icon =
                !restricted && attachment.mimeType === 'application/pdf' ? FileText : Paperclip;
              return (
                <li className="vn-attachment-row" key={attachment.id}>
                  <span className="vn-content-file-icon">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <div className="vn-attachment-copy">
                    <div className="vn-row">
                      <span className="vn-field-label">{name}</span>
                      {!ready && (
                        <Badge variant={itemState === 'failed' ? 'danger' : 'warning'}>
                          {attachmentStates[itemState]}
                        </Badge>
                      )}
                    </div>
                    {!restricted && attachment.caption && attachment.caption !== name && (
                      <p className="vn-content-value">{attachment.caption}</p>
                    )}
                    {!restricted && (
                      <p className="vn-content-meta">
                        {attachment.mimeType === 'application/pdf'
                          ? 'PDF'
                          : attachment.mimeType === 'image/jpeg'
                            ? 'JPEG'
                            : attachment.mimeType === 'image/png'
                              ? 'PNG'
                              : attachment.mimeType === 'image/webp'
                                ? 'WebP'
                                : attachment.mimeType || '文件类型未知'}{' '}
                        · {sizeLabel(attachment.fileSize)}
                        {attachment.sensitivity !== 'NORMAL' && ' · 受保护内容'}
                      </p>
                    )}
                    {presentation?.reason && (
                      <p className="vn-content-meta">{presentation.reason}</p>
                    )}
                    {ready && !onOpen && <p className="vn-content-meta">当前无法打开附件。</p>}
                  </div>
                  <div className="vn-row vn-attachment-actions">
                    {onOpen && !restricted && (
                      <Button
                        variant="secondary"
                        disabled={!ready}
                        onClick={() => {
                          if (ready) onOpen(attachment, presentation?.url);
                        }}
                        aria-label={`查看${name}`}
                      >
                        查看
                      </Button>
                    )}
                    {onRemove && !readOnly && !restricted && (
                      <Button
                        variant="quiet"
                        disabled={!ready || removal.kind !== 'available'}
                        onClick={() => {
                          if (ready && removal.kind === 'available') onRemove(attachment);
                        }}
                        aria-label={`移除${name}`}
                      >
                        移除
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}
