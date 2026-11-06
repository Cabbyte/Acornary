import { Input } from '../components/ui/input';
import { FormField } from '../components/ui/form-field';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { CapabilityNotice } from './capability-notice';
import { InlineNotice } from '../components/ui/inline-notice';
import type { ActionAvailability } from './types';
import { cn } from '../components/utils';
import './content.css';

export interface PendingAttachment {
  /** Local draft identity supplied by the caller, never an attachment record ID. */
  id: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  state: 'selected' | 'uploading' | 'failed' | 'unknown';
  reason?: string;
}
export interface AttachmentFieldProps {
  capability: ActionAvailability;
  allowLocalSelection: boolean;
  pending: readonly PendingAttachment[];
  onFilesSelected?: (files: readonly File[]) => void;
  onUploadIntent?: (ids: readonly string[]) => void;
  onRetry?: (id: string) => void;
  onRemove?: (id: string) => void;
  readOnly?: boolean;
  busy?: boolean;
  error?: string;
  accept?: string;
  multiple?: boolean;
  className?: string;
}
const stateLabels = {
  selected: '待添加',
  uploading: '正在处理',
  failed: '添加失败',
  unknown: '结果未知',
};

/** Native browser selection is opt-in; selected File objects leave only through a callback.
 * Input semantics: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/file */
export function AttachmentField({
  capability,
  allowLocalSelection,
  pending,
  onFilesSelected,
  onUploadIntent,
  onRetry,
  onRemove,
  readOnly,
  busy,
  error,
  accept = 'image/jpeg,image/png,image/webp,application/pdf',
  multiple = true,
  className,
}: AttachmentFieldProps) {
  const enabled = capability.kind === 'available' && !readOnly && !busy;
  const selected = pending.filter((file) => file.state === 'selected');
  return (
    <section
      className={cn('vn-content-panel vn-stack', className)}
      aria-label="添加附件"
      aria-busy={busy || pending.some((file) => file.state === 'uploading') || undefined}
    >
      <div>
        <h3 className="vn-section-title">添加附件</h3>
        <p className="vn-content-meta">先选择文件，再确认添加。处理结果会保留在列表中。</p>
      </div>
      {capability.kind !== 'available' && (
        <CapabilityNotice capabilityLabel="添加附件" availability={capability} />
      )}
      {readOnly && <p className="vn-content-meta">当前为只读，待处理文件保持原样。</p>}
      {error && (
        <InlineNotice tone="danger" title="附件尚未添加">
          {error}
        </InlineNotice>
      )}
      {allowLocalSelection && onFilesSelected && capability.kind === 'available' ? (
        <FormField label="选择文件" hint="选择文件不会自动上传。支持的类型由当前入口提供。">
          <Input
            type="file"
            accept={accept}
            multiple={multiple}
            disabled={!enabled}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (enabled && files.length) onFilesSelected(files);
              event.currentTarget.value = '';
            }}
          />
        </FormField>
      ) : (
        capability.kind === 'available' && (
          <CapabilityNotice
            capabilityLabel="选择本机文件"
            availability={{
              kind: 'unsupportedHost',
              reason: '当前入口不能选择本机文件，请在支持附件的应用入口继续。',
            }}
          />
        )
      )}
      {!pending.length ? (
        <p className="vn-content-meta">尚未选择待添加的文件。</p>
      ) : (
        <ul className="vn-attachment-list">
          {pending.map((file) => (
            <li className="vn-attachment-row" key={file.id}>
              <div className="vn-attachment-copy">
                <div className="vn-row">
                  <span className="vn-field-label">{file.name}</span>
                  <Badge
                    variant={
                      file.state === 'failed'
                        ? 'danger'
                        : file.state === 'unknown'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {stateLabels[file.state]}
                  </Badge>
                </div>
                <p className="vn-content-meta">
                  {file.mimeType || '文件类型未知'} ·{' '}
                  {file.size === null || !Number.isFinite(file.size) || file.size < 0
                    ? '大小未知'
                    : `${file.size} B`}
                </p>
                {file.reason && <p className="vn-content-meta">{file.reason}</p>}
                {file.state === 'unknown' && (
                  <p className="vn-content-meta">
                    请先核对处理结果，再决定是否重试；此文件仍保留。
                  </p>
                )}
              </div>
              <div className="vn-row vn-attachment-actions">
                {file.state === 'failed' && onRetry && (
                  <Button variant="secondary" disabled={!enabled} onClick={() => onRetry(file.id)}>
                    重试
                  </Button>
                )}
                {(file.state === 'selected' || file.state === 'failed') && onRemove && (
                  <Button variant="quiet" disabled={!enabled} onClick={() => onRemove(file.id)}>
                    移除
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {onUploadIntent && (
        <div className="vn-row">
          <Button
            disabled={!enabled || selected.length === 0}
            busy={busy}
            onClick={() => {
              if (enabled && selected.length) onUploadIntent(selected.map((file) => file.id));
            }}
          >
            添加所选文件{selected.length > 0 ? `（${selected.length}）` : ''}
          </Button>
        </div>
      )}
      {!onUploadIntent && pending.some((file) => file.state === 'selected') && (
        <p className="vn-content-meta">当前入口未提供添加能力，所选文件仍保留。</p>
      )}
    </section>
  );
}
