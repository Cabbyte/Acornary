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
      <h3 className="vn-section-title">记录已变化，请逐项核对</h3>
      <p className="vn-operation-summary">{scopeLabel}</p>
      <code className="vn-operation-id">{objectId}</code>
      <p className="vn-muted">
        原版本 {originalRevision} → 当前版本 {currentRevision ?? '未知'}。你的输入保持不变。
      </p>
      <div className="vn-operation-table-wrap">
        <table className="vn-operation-table">
          <caption>原值、当前值与本次输入</caption>
          <thead>
            <tr>
              <th scope="col">字段</th>
              <th scope="col">原值</th>
              <th scope="col">当前值</th>
              <th scope="col">我的输入</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.key}>
                <th scope="row">{field.label}</th>
                <td>{valueText(field.original)}</td>
                <td>{valueText(field.current)}</td>
                <td>{valueText(field.input)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fields.map((field) => (
        <RadioGroup
          key={field.key}
          label={`${field.label}：核对后的选择`}
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
      ))}
      {(!fields.length || currentRevision === null) && (
        <InlineNotice tone="warning" title="当前对比资料不完整">
          请重新读取；不会用猜测值替换版本。
        </InlineNotice>
      )}
      {availability.kind !== 'available' && (
        <InlineNotice tone="warning" title="暂不能重新确认">
          {availability.reason}
        </InlineNotice>
      )}
      <div className="vn-operation-actions">
        <Button variant="secondary" disabled={busy} onClick={onRefresh}>
          重新读取当前记录
        </Button>
        <Button disabled={blocked || !complete || currentRevision === null} onClick={onReconfirm}>
          重新确认所选意图
        </Button>
      </div>
      <p className="vn-muted">选择只表示核对意图，是否提交由后续任务决定。</p>
    </section>
  );
}
