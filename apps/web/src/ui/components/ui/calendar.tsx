import { DayPicker } from 'react-day-picker';
import { zhCN } from 'react-day-picker/locale';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { cn } from '../utils';
import '../../patterns/fields.css';

// shadcn's Calendar uses DayPicker: https://ui.shadcn.com/docs/components/base/calendar
// Controlled month/selection and Chinese locale: https://daypicker.dev/docs/selection-modes/
export interface CalendarProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  month: string;
  onMonthChange: (month: string) => void;
  today?: string | null;
  min?: string;
  max?: string;
  disabled?: boolean;
  readOnly?: boolean;
  label?: string;
  className?: string;
}

/** Validates a civil Gregorian date before constructing a Date for DayPicker's UI. */
export function isPlainDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = parseInt(match[1], 10),
    month = parseInt(match[2], 10),
    day = parseInt(match[3], 10);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
export function plainDateToCalendarDate(value: string): Date | undefined {
  if (!isPlainDate(value)) return undefined;
  const [year, month, day] = value.split('-').map((part) => parseInt(part, 10));
  // UI-only bridge: UTC calendar and UTC getters are paired; no browser-zone conversion.
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  result.setUTCHours(12, 0, 0, 0);
  return result;
}
export function calendarDateToPlainDate(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
export function dateValidationMessage(
  value: string | null,
  min?: string,
  max?: string,
): string | undefined {
  if ((min && !isPlainDate(min)) || (max && !isPlainDate(max)) || (min && max && min > max))
    return '日期范围配置无效，请先核对上下限。';
  if (value === null || value === '') return undefined;
  if (!isPlainDate(value))
    return '请输入有效的完整日期 YYYY-MM-DD；月份、日期和闰年不能省略或自动修正。';
  if (min && value < min) return `日期不能早于 ${min}。`;
  if (max && value > max) return `日期不能晚于 ${max}。`;
  return undefined;
}

export function Calendar({
  value,
  onValueChange,
  month,
  onMonthChange,
  today,
  min,
  max,
  disabled,
  readOnly,
  label = '选择日期',
  className,
}: CalendarProps) {
  const monthDate = plainDateToCalendarDate(`${month}-01`);
  const selected = value ? plainDateToCalendarDate(value) : undefined;
  const todayDate = today ? plainDateToCalendarDate(today) : undefined;
  const invalid = dateValidationMessage(value, min, max);
  const invalidBounds = Boolean(dateValidationMessage(null, min, max));
  if (!monthDate)
    return (
      <div className="vn-field-error" role="alert">
        日历月份无效，暂时无法显示。
      </div>
    );
  return (
    <div className={cn('vn-calendar', className)} data-known-today={Boolean(todayDate)}>
      {invalid && (
        <p className="vn-field-error" role="alert">
          {invalid}
          {value && <> 原值：{value}</>}
        </p>
      )}
      {readOnly && <p className="vn-muted">只读日期，可浏览月份。</p>}
      <DayPicker
        mode="single"
        timeZone="UTC"
        selected={selected}
        month={monthDate}
        locale={zhCN}
        weekStartsOn={1}
        onSelect={(date) => {
          if (!disabled && !readOnly && !invalidBounds)
            onValueChange(date ? calendarDateToPlainDate(date) : null);
        }}
        onMonthChange={(date) => onMonthChange(calendarDateToPlainDate(date).slice(0, 7))}
        // DayPicker requires a valid reference for weekday headers. Without today, use the
        // supplied month only for focus/header calculations and suppress today's UI semantics.
        today={todayDate ?? monthDate}
        startMonth={min ? plainDateToCalendarDate(min) : plainDateToCalendarDate('0001-01-01')}
        endMonth={max ? plainDateToCalendarDate(max) : plainDateToCalendarDate('9999-12-31')}
        disabled={(date) =>
          Boolean(
            disabled ||
            readOnly ||
            invalidBounds ||
            (min && calendarDateToPlainDate(date) < min) ||
            (max && calendarDateToPlainDate(date) > max),
          )
        }
        disableNavigation={disabled || invalidBounds}
        showOutsideDays
        fixedWeeks
        aria-label={label}
        labels={{
          labelNext: () => '下个月',
          labelPrevious: () => '上个月',
          labelNav: () => '切换月份',
          labelGrid: (date) => `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`,
          labelDayButton: (date, modifiers) =>
            `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日${modifiers.selected ? '，已选择' : ''}${todayDate && modifiers.today ? '，今天' : ''}`,
          labelWeekday: (date) =>
            ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][
              date.getUTCDay()
            ],
        }}
        formatters={{
          formatCaption: (date) => `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`,
        }}
        components={{
          Chevron: ({ orientation, className }) => {
            const Glyph =
              orientation === 'left'
                ? ChevronLeft
                : orientation === 'right'
                  ? ChevronRight
                  : orientation === 'up'
                    ? ChevronUp
                    : ChevronDown;
            return <Glyph className={className} size={16} aria-hidden="true" />;
          },
        }}
      />
      <details className="vn-field-details">
        <summary>键盘操作</summary>
        <p className="vn-muted">方向键移动日期，Page Up / Down 切换月份。</p>
      </details>
    </div>
  );
}
