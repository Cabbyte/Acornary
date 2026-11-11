import { useState } from 'react';
import { DateInput } from '../components/ui/date-input';
import { isPlainDate } from '../components/ui/calendar';
import { Select } from '../components/ui/select';
import { FormField } from '../components/ui/form-field';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import type { DateFactPresentation } from './types';
import { cn } from '../components/utils';
import './fields.css';

export interface DateFactFieldProps {
  fact: DateFactPresentation;
  onChange: (fact: DateFactPresentation) => void;
  timezone: string | null;
  month: string;
  onMonthChange: (month: string) => void;
  today?: string | null;
  /** Only the caller can require a basis; presentation never infers a blocking rule. */
  basisRequired?: boolean;
  /** Hide optional metadata in quick forms; required basis remains visible. */
  showDetails?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  error?: string;
  className?: string;
}
const kindLabels: Record<DateFactPresentation['kind'], string> = {
  EXPIRY: '有效期限',
  WARRANTY_END: '保修结束',
  SERVICE_DUE: '保养日期',
  RETURN_BY: '归还期限',
  RENEWAL: '续期日期',
  REORDER_BY: '补货日期',
};
const stateLabels = {
  UPCOMING: '未到期',
  DUE: '已到期',
  OVERDUE: '已逾期',
  COMPLETED: '已完成',
  UNKNOWN: '状态待确认',
} as const;

/** Changes only explicit draft fields; type, source, and server-computed state are preserved. */
export function DateFactField({
  fact,
  onChange,
  timezone,
  month,
  onMonthChange,
  today,
  basisRequired = false,
  showDetails = true,
  disabled,
  readOnly,
  loading,
  error,
  className,
}: DateFactFieldProps) {
  // Keep the editing field in one position while its first character changes the draft.
  const [basisInitiallyVisible] = useState(
    () => Boolean(fact.dueOn) && fact.dateKind === 'ESTIMATED' && !fact.basis,
  );
  const showBasis =
    basisRequired || basisInitiallyVisible || (fact.dateKind === 'ESTIMATED' && !showDetails);
  const invalidCompletion =
    fact.state === 'COMPLETED' && !!fact.completedOn && !isPlainDate(fact.completedOn);
  const basisField = (
    <FormField label="日期依据" required={basisRequired}>
      <Textarea
        rows={2}
        value={fact.basis ?? ''}
        onChange={(event) => onChange({ ...fact, basis: event.target.value || null })}
        disabled={disabled || loading}
        readOnly={readOnly}
        placeholder="如包装标注、估计依据；未填写表示未记录"
      />
    </FormField>
  );
  return (
    <section
      className={cn('vn-domain-field vn-date-fact-field', className)}
      aria-label={`${kindLabels[fact.kind]}字段`}
      aria-busy={loading || undefined}
    >
      <div className="vn-date-fact-field__controls" data-expiry={fact.kind === 'EXPIRY'}>
        {fact.kind === 'EXPIRY' && (
          <Select
            label="日期类型"
            value={fact.dateKind ?? 'unrecorded'}
            onValueChange={(dateKind) => {
              if (dateKind === 'unrecorded') onChange({ ...fact, dateKind: null });
              else if (
                dateKind === 'BEST_BEFORE' ||
                dateKind === 'USE_BY' ||
                dateKind === 'ESTIMATED'
              )
                onChange({ ...fact, dateKind });
            }}
            options={[
              { value: 'unrecorded', label: '类型未记录' },
              {
                value: 'BEST_BEFORE',
                label: '最佳食用期',
                description: '以包装上的原始标注为准。',
              },
              { value: 'USE_BY', label: '限用日期', description: '以明确标注的限用日期为准。' },
              { value: 'ESTIMATED', label: '估计日期', description: '保留估计性质。' },
            ]}
            disabled={disabled || loading}
            readOnly={readOnly}
          />
        )}
        <DateInput
          label={fact.kind === 'EXPIRY' ? '日期' : fact.label || kindLabels[fact.kind]}
          value={fact.dueOn}
          onValueChange={(dueOn) => onChange({ ...fact, dueOn })}
          month={month}
          onMonthChange={onMonthChange}
          today={today}
          disabled={disabled || loading}
          readOnly={readOnly}
          error={error}
        />
      </div>
      {!timezone && <p className="vn-fields-notice">家庭时区未设置，日期状态待确认。</p>}
      {!loading && fact.state !== 'UPCOMING' && (
        <div className="vn-fields-status">
          <span className="vn-muted">当前记录</span>
          <Badge
            variant={
              invalidCompletion || fact.state === 'OVERDUE'
                ? 'danger'
                : fact.state === 'DUE'
                  ? 'warning'
                  : fact.state === 'COMPLETED'
                    ? 'success'
                    : 'neutral'
            }
          >
            {invalidCompletion ? '完成日期有误' : stateLabels[fact.state]}
          </Badge>
        </div>
      )}
      {invalidCompletion && (
        <p className="vn-fields-notice" role="alert">
          完成日期格式有误，请核对原始记录。
        </p>
      )}
      {showBasis && basisField}
      {showDetails && (
        <details className="vn-field-details">
          <summary>{showBasis ? '日期详情' : '依据与详情'}</summary>
          <div className="vn-field-details__content">
            {!showBasis && basisField}
            {fact.label && fact.kind === 'EXPIRY' && (
              <span className="vn-muted">记录名称：{fact.label}</span>
            )}
            {fact.source && (
              <span className="vn-muted">
                来源：{fact.source === 'LIFECYCLE' ? '生命周期事实' : '期限记录'}
              </span>
            )}
            {timezone && <span className="vn-muted">家庭时区：{timezone}</span>}
            {fact.state === 'COMPLETED' && fact.completedOn && (
              <span className="vn-muted">
                完成日期：{isPlainDate(fact.completedOn) ? fact.completedOn : '日期格式有误'}
              </span>
            )}
          </div>
        </details>
      )}
      {loading && (
        <span className="vn-muted" role="status">
          正在读取日期…
        </span>
      )}
    </section>
  );
}
