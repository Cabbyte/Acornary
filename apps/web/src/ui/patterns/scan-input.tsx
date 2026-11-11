import { Camera, ScanLine } from 'lucide-react';
import { Button } from '../components/ui/button';
import { FormField } from '../components/ui/form-field';
import { Input } from '../components/ui/input';
import { InlineNotice } from '../components/ui/inline-notice';
import { RadioGroup } from '../components/ui/radio-group';
import { CapabilityNotice } from './capability-notice';
import { LoadingState } from './loading-state';
import type { ActionAvailability } from './types';
import './operations.css';

export interface ScanCandidate {
  id: string;
  name: string;
  locationLabel: string;
  unavailableReason?: string;
}
export type ScanResult =
  | { kind: 'idle' | 'loading' }
  | { kind: 'ItemQR'; sourceText: string; item: ScanCandidate }
  | {
      kind: 'barcode';
      sourceText: string;
      barcode: string;
      candidates: readonly ScanCandidate[];
      hasMore: boolean;
    }
  | { kind: 'ambiguous'; sourceText: string; candidates: readonly ScanCandidate[]; reason: string }
  | { kind: 'unknown' | 'forbidden' | 'error'; sourceText: string; reason: string };
export interface ScanInputProps {
  rawText: string;
  onRawTextChange: (value: string) => void;
  onResolve: (rawText: string) => void;
  result: ScanResult;
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
  onContinue: (id: string) => void;
  cameraAvailability: ActionAvailability;
  onRequestCamera?: () => void;
  onLoadMoreCandidates?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
}
export function ScanInput({
  rawText,
  onRawTextChange,
  onResolve,
  result,
  selectedItemId,
  onSelectItem,
  onContinue,
  cameraAvailability,
  onRequestCamera,
  onLoadMoreCandidates,
  disabled = false,
  readOnly = false,
}: ScanInputProps) {
  const busy = result.kind === 'loading';
  const stale = 'sourceText' in result && result.sourceText !== rawText;
  const candidates = stale
    ? []
    : result.kind === 'ItemQR'
      ? [result.item]
      : result.kind === 'barcode' || result.kind === 'ambiguous'
        ? result.candidates
        : [];
  const selected = candidates.find(
    (candidate) => candidate.id === selectedItemId && !candidate.unavailableReason,
  );
  const effectiveCamera: ActionAvailability =
    cameraAvailability.kind === 'available' && !onRequestCamera
      ? { kind: 'missingContract', reason: '请手动输入或粘贴编码。' }
      : cameraAvailability;
  return (
    <section className="vn-operation-card vn-stack" aria-label="扫码或手动输入">
      <div className="vn-scan-entry">
        <FormField label="二维码或条码" disabled={disabled}>
          <Input
            value={rawText}
            placeholder="输入或粘贴完整编码"
            readOnly={readOnly}
            onChange={(event) => onRawTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !disabled && !readOnly && !busy && rawText.trim()) {
                event.preventDefault();
                onResolve(rawText);
              }
            }}
          />
        </FormField>
        <div className="vn-operation-actions">
          <Button
            aria-label="识别编码"
            title="识别编码"
            disabled={disabled || readOnly || !rawText.trim()}
            busy={busy}
            onClick={() => onResolve(rawText)}
          >
            <ScanLine size={18} aria-hidden="true" />
            <span className="vn-scan-action-label">识别</span>
          </Button>
          <Button
            aria-label="打开相机扫码"
            title="打开相机扫码"
            variant="secondary"
            disabled={disabled || readOnly || busy || effectiveCamera.kind !== 'available'}
            onClick={onRequestCamera}
          >
            <Camera size={16} aria-hidden="true" />
            <span className="vn-scan-action-label">相机</span>
          </Button>
        </div>
      </div>
      {effectiveCamera.kind !== 'available' && (
        <CapabilityNotice capabilityLabel="相机扫码" availability={effectiveCamera} />
      )}
      {busy && <LoadingState layout="compact" label="正在识别编码" />}
      {stale ? (
        <InlineNotice tone="warning" title="输入已改变">
          请重新识别并选择物品。
        </InlineNotice>
      ) : result.kind === 'unknown' || result.kind === 'forbidden' || result.kind === 'error' ? (
        <InlineNotice
          tone={result.kind === 'forbidden' || result.kind === 'error' ? 'danger' : 'warning'}
          title={
            result.kind === 'forbidden'
              ? '无权读取此编码对应的内容'
              : result.kind === 'error'
                ? '识别读取失败'
                : '尚未识别此编码'
          }
        >
          {result.reason}
        </InlineNotice>
      ) : result.kind === 'barcode' ? (
        <InlineNotice tone="info" title="识别到商品条码">
          同一条码可能对应多件物品，请选择具体一件。
        </InlineNotice>
      ) : result.kind === 'ambiguous' ? (
        <InlineNotice tone="warning" title="此编码存在多个候选">
          {result.reason}
        </InlineNotice>
      ) : result.kind === 'ItemQR' ? (
        <p className="vn-operation-reference">已识别物品二维码，请核对后选择。</p>
      ) : null}
      {candidates.length > 0 && (
        <RadioGroup
          showOptionDescriptions
          label="选择物品"
          value={selected?.id ?? null}
          onValueChange={onSelectItem}
          disabled={disabled || busy}
          readOnly={readOnly}
          options={candidates.map((candidate) => ({
            value: candidate.id,
            label: candidate.name,
            disabled: !!candidate.unavailableReason,
            description: (
              <>
                <span>{candidate.locationLabel}</span>
                <code className="vn-operation-id">{candidate.id}</code>
                {candidate.unavailableReason && <span> · {candidate.unavailableReason}</span>}
              </>
            ),
          }))}
        />
      )}
      {!stale && result.kind === 'barcode' && !candidates.length && (
        <InlineNotice tone="info" title="当前未找到可选物品">
          不代表完整库存中没有对应商品。
        </InlineNotice>
      )}
      {!stale && result.kind === 'barcode' && result.hasMore && (
        <div className="vn-operation-actions">
          <Button
            aria-label="打开相机扫码"
            title="打开相机扫码"
            variant="secondary"
            disabled={!onLoadMoreCandidates || disabled || busy}
            onClick={onLoadMoreCandidates}
          >
            更多候选
          </Button>
        </div>
      )}
      <div className="vn-operation-actions">
        <Button
          disabled={!selected || disabled || readOnly || busy}
          onClick={() => {
            if (selected) onContinue(selected.id);
          }}
        >
          确认物品
        </Button>
      </div>
    </section>
  );
}
