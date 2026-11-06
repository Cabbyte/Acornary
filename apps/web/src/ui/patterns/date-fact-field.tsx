import { DateInput } from '../components/ui/date-input';
import { Select } from '../components/ui/select';
import { FormField } from '../components/ui/form-field';
import { Textarea } from '../components/ui/textarea';
import { DateFactValue } from './date-fact-value';
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

/** Changes only explicit draft fields; type, source, and server-computed state are preserved. */
export function DateFactField({
  fact,
  onChange,
  timezone,
  month,
  onMonthChange,
  today,
  disabled,
  readOnly,
  loading,
  error,
  className,
}: DateFactFieldProps) {
  return (
    <section
      className={cn('vn-domain-field', className)}
      aria-label={`${kindLabels[fact.kind]}字段`}
      aria-busy={loading || undefined}
    >
      <span className="vn-fields-label">日期用途：{kindLabels[fact.kind]}</span>
      <DateInput
        label={fact.label || kindLabels[fact.kind]}
        value={fact.dueOn}
        onValueChange={(dueOn) => onChange({ ...fact, dueOn })}
        month={month}
        onMonthChange={onMonthChange}
        today={today}
        disabled={disabled || loading}
        readOnly={readOnly}
        error={error}
        hint="清除日期后，仍保留日期用途和依据。"
      />
      {fact.kind === 'EXPIRY' && (
        <Select
          label="日期口径"
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
            { value: 'unrecorded', label: '日期口径未记录' },
            { value: 'BEST_BEFORE', label: '最佳食用期', description: '以包装上的原始标注为准。' },
            { value: 'USE_BY', label: '限用日期', description: '以明确标注的限用日期为准。' },
            { value: 'ESTIMATED', label: '估计日期', description: '保留估计性质。' },
          ]}
          disabled={disabled || loading}
          readOnly={readOnly}
        />
      )}
      <FormField label="日期依据" hint="例如包装标注、人工估计或其他来源说明。">
        <Textarea
          rows={2}
          value={fact.basis ?? ''}
          onChange={(event) => onChange({ ...fact, basis: event.target.value || null })}
          disabled={disabled || loading}
          readOnly={readOnly}
          placeholder="依据未记录"
        />
      </FormField>
      <p className="vn-fields-notice">
        {timezone
          ? `家庭时区：${timezone}。修改日期后，请重新确认日期状态。`
          : '家庭时区尚未设置；日期状态待确认。'}
      </p>
      <DateFactValue fact={fact} loading={loading} />
    </section>
  );
}
