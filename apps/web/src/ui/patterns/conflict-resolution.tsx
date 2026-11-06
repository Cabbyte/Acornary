import { Button } from '../components/ui/button';
import { InlineNotice } from '../components/ui/inline-notice';
import { RadioGroup } from '../components/ui/radio-group';
import type { ActionAvailability } from './types';
import './operations.css';

export type ConflictValue =
  { kind: 'known'; text: string } | { kind: 'unknown' | 'redacted' | 'absent' };
export interface ConflictField {
  key: string;
  label: string;
  original: ConflictValue;
  current: ConflictValue;
  input: ConflictValue;
}
export interface ConflictResolutionProps {
  objectId: string;
  scopeLabel: string;
  originalRevision: number;
  currentRevision: number | null;
  fields: readonly ConflictField[];
  choices: Readonly<Record<string, 'current' | 'input' | undefined>>;
  availability: ActionAvailability;
  busy?: boolean;
  onChoose: (fieldKey: string, choice: 'current' | 'input') => void;
  onRefresh: () => void;
  onReconfirm: () => void;
}
function valueText(value: ConflictValue) {
  return value.kind === 'known'
    ? value.text || '（空文本）'
    : value.kind === 'redacted'
      ? '内容不可见'
      : value.kind === 'absent'
        ? '未设置'
        : '未知';
}
export function ConflictResolution({
  objectId,
  scopeLabel,
  originalRevision,
  currentRevision,
  fields,
  choices,
  availability,
  busy = false,
  onChoose,
  onRefresh,
  onReconfirm,
}: ConflictResolutionProps) {
  const blocked = busy || availability.kind !== 'available';
  const complete =
    fields.length > 0 &&
    fields.every(
      (field) =>
        !!choices[field.key] &&
        field.current.kind !== 'redacted' &&
        field.input.kind !== 'redacted' &&
        field.current.kind !== 'unknown' &&
        field.input.kind !== 'unknown',
    );
  return (
    <section
      className="vn-operation-card vn-stack"
      aria-label="版本冲突对比"
      aria-busy={busy || undefined}
    >
      <h3 className="vn-section-title">记录已变化</h3>
      <p className="vn-operation-summary">{scopeLabel}</p>
      {fields.map((field) => (
        <div key={field.key} className="vn-conflict-field">
          <RadioGroup
            className="vn-conflict-choice"
            label={
              <span className="vn-conflict-heading">
                <span>{field.label}</span>
                <span className="vn-operation-reference">原值：{valueText(field.original)}</span>
              </span>
            }
            value={choices[field.key] ?? null}
            onValueChange={(choice) => onChoose(field.key, choice as 'current' | 'input')}
            disabled={
              blocked ||
              field.current.kind === 'unknown' ||
              field.current.kind === 'redacted' ||
              field.input.kind === 'redacted' ||
              field.input.kind === 'unknown'
            }
            options={[
              { value: 'current', label: '采用当前值', description: valueText(field.current) },
              { value: 'input', label: '保留我的输入', description: valueText(field.input) },
            ]}
          />
        </div>
      ))}
      {(!fields.length || currentRevision === null) && (
        <InlineNotice
          tone="warning"
          title={currentRevision === null ? '当前记录版本未知' : '当前对比资料不完整'}
        >
          请刷新记录后核对。
        </InlineNotice>
      )}
      {availability.kind !== 'available' && (
        <InlineNotice tone="warning" title="暂不能重新确认">
          {availability.reason}
        </InlineNotice>
      )}
      <details className="vn-operation-details">
        <summary>版本详情</summary>
        <code className="vn-operation-id">{objectId}</code>
        <p className="vn-operation-summary">
          原版本 {originalRevision} → 当前版本 {currentRevision ?? '未知'}
        </p>
      </details>
      <div className="vn-operation-actions">
        <Button variant="secondary" disabled={busy} onClick={onRefresh}>
          刷新记录
        </Button>
        <Button disabled={blocked || !complete || currentRevision === null} onClick={onReconfirm}>
          确认选择
        </Button>
      </div>
    </section>
  );
}
