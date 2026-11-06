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
      ? { kind: 'missingContract', reason: '当前未接入相机入口，可手动输入或粘贴编码。' }
      : cameraAvailability;
  return (
    <section className="vn-operation-card vn-stack" aria-label="扫码或手动输入">
      <FormField
        label="二维码或条码内容"
        hint="可以粘贴完整编码；识别后请核对具体物品。"
        disabled={disabled}
      >
        <Input
          value={rawText}
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
          disabled={disabled || readOnly || !rawText.trim()}
          busy={busy}
          onClick={() => onResolve(rawText)}
        >
          识别输入
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || readOnly || busy || effectiveCamera.kind !== 'available'}
          onClick={onRequestCamera}
        >
          使用相机
        </Button>
      </div>
      {effectiveCamera.kind !== 'available' && (
        <CapabilityNotice capabilityLabel="相机扫码" availability={effectiveCamera} />
      )}
      {busy && <LoadingState layout="compact" label="正在识别编码" />}
      {stale ? (
        <InlineNotice tone="warning" title="输入已改变">
          请重新识别后选择物品，旧候选不会用于本次输入。
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
          条码不等于一件实物。请从当前返回的候选中明确选择，不能自动推定某件物品。
        </InlineNotice>
      ) : result.kind === 'ambiguous' ? (
        <InlineNotice tone="warning" title="此编码存在多个候选">
          {result.reason}
        </InlineNotice>
      ) : result.kind === 'ItemQR' ? (
        <p className="vn-muted">识别到物品二维码，请核对完整身份后选择。</p>
      ) : null}
      {candidates.length > 0 && (
        <RadioGroup
          label="明确选择一件物品"
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
                <code className="vn-operation-id">{candidate.id}</code>
                <span>{candidate.locationLabel}</span>
                {candidate.unavailableReason && <span> · {candidate.unavailableReason}</span>}
              </>
            ),
          }))}
        />
      )}
      {!stale && result.kind === 'barcode' && !candidates.length && (
        <InlineNotice tone="info" title="当前没有返回可选物品">
          这不证明完整库存中不存在对应商品。
        </InlineNotice>
      )}
      {!stale && result.kind === 'barcode' && result.hasMore && (
        <div className="vn-operation-actions">
          <Button
            variant="secondary"
            disabled={!onLoadMoreCandidates || disabled || busy}
            onClick={onLoadMoreCandidates}
          >
            读取更多候选
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
          使用明确选择的物品
        </Button>
      </div>
    </section>
  );
}
