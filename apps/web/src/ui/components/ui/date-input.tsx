import { useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { Calendar, dateValidationMessage, type CalendarProps } from './calendar';
import { Input } from './input';
import { FormField } from './form-field';
import { IconButton } from './icon-button';
import { Popover } from './popover';
import { cn } from '../utils';
import '../../patterns/fields.css';

// Composition pattern: https://ui.shadcn.com/docs/components/base/date-picker
export interface DateInputProps extends Omit<CalendarProps, 'label'> {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  clearable?: boolean;
  onCommit?: (value: string | null) => void;
}
export function DateInput({
  value,
  onValueChange,
  month,
  onMonthChange,
  label,
  hint,
  error,
  required,
  clearable = true,
  onCommit,
  disabled,
  readOnly,
  today,
  min,
  max,
  className,
}: DateInputProps) {
  const [open, setOpen] = useState(false);
  const validation = error || dateValidationMessage(value, min, max);
  const commit = () => {
    if (!disabled && !readOnly && !validation && (!required || value)) onCommit?.(value || null);
  };
  return (
    <div className={cn('vn-date-input', className)}>
      <FormField
        label={label}
        required={required}
        error={validation}
        hint={hint ?? '按 YYYY-MM-DD 直接输入，或打开日历选择；空值表示未记录。'}
      >
        {(props) => (
          <div className="vn-field-inline">
            <Input
              {...props}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={value ?? ''}
              disabled={disabled}
              readOnly={readOnly}
              placeholder="YYYY-MM-DD"
              onChange={(event) => onValueChange(event.target.value || null)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  commit();
                }
              }}
            />
            <Popover
              open={open}
              onOpenChange={(nextOpen) => {
                if (nextOpen && value && !dateValidationMessage(value, min, max))
                  onMonthChange(value.slice(0, 7));
                setOpen(nextOpen);
              }}
              disabled={disabled || readOnly}
              className="vn-date-popover"
              title={`选择${label}`}
              trigger={
                <IconButton
                  label={`打开${label}日历`}
                  variant="secondary"
                  disabled={disabled || readOnly}
                >
                  <CalendarDays />
                </IconButton>
              }
            >
              <Calendar
                value={value}
                onValueChange={(date) => {
                  onValueChange(date);
                  if (date !== null || !required) onCommit?.(date);
                  setOpen(false);
                }}
                month={month}
                onMonthChange={onMonthChange}
                today={today}
                min={min}
                max={max}
              />
            </Popover>
            {clearable && value !== null && value !== '' && (
              <IconButton
                label={`清除${label}`}
                disabled={disabled || readOnly}
                onClick={() => {
                  onValueChange(null);
                  if (!required) onCommit?.(null);
                }}
              >
                <X />
              </IconButton>
            )}
          </div>
        )}
      </FormField>
    </div>
  );
}
