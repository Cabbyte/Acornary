import { DatePicker, InputNumber, type DatePickerProps } from 'antd';
import dayjs from 'dayjs';
import type { ComponentProps } from 'react';

/** Domain dates remain local strings; never turn a calendar date into a UTC instant. */
export function CalendarInput({
  value,
  onChange,
  withTime = false,
  ...props
}: Omit<
  DatePickerProps,
  'value' | 'onChange' | 'showTime' | 'multiple' | 'defaultValue' | 'onOk'
> & { value: string; onChange: (value: string) => void; withTime?: boolean }) {
  const format = withTime ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD';
  return (
    <DatePicker
      {...props}
      value={value && dayjs(value).isValid() ? dayjs(value) : null}
      showTime={withTime}
      format={withTime ? 'YYYY-MM-DD HH:mm' : format}
      onChange={(date) => onChange(date?.format(format) ?? '')}
      allowClear
    />
  );
}
/** Decimal values and cleared fields round-trip through the existing string draft schema. */
export function DecimalInput({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<typeof InputNumber<string>>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <InputNumber<string>
      {...props}
      stringMode
      changeOnBlur={false}
      onInput={onChange}
      value={value || null}
      onChange={(next) => onChange(next ?? '')}
    />
  );
}
