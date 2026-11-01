import { Fragment } from 'react';
import { Input, Select } from 'antd';
import { Field } from '../../ui/primitives';
import { CalendarInput, DecimalInput } from '../../ui/inputs';
import { label } from '../../lib/presentation';
import type { Definition } from '../../ui/fields';
import type { WriteFieldsProps } from './types';
import styles from './WriteSheet.module.css';

/** Receives the controller's supported field definitions; never inspects raw bindings. */
export function AttributeEditor({
  fields,
  values,
  onChange,
}: WriteFieldsProps & { fields: Definition[] }) {
  return (
    <div className={styles.fields}>
      {fields.map((field, index) => (
        <Fragment key={field.path}>
          <Field
            label={field.label}
            hint={field.type === 'list' ? '多个条码用逗号分隔；留空表示未记录' : undefined}
          >
            {field.options ? (
              <Select
                autoFocus={index === 0}
                value={values[field.path] ?? ''}
                onChange={(value) => onChange(field.path, value)}
                options={[
                  { value: '', label: '未记录' },
                  ...field.options.map((value) => ({
                    value,
                    label:
                      field.path === 'expiry.date_kind' && value === 'ESTIMATED'
                        ? '计划吃完（自行设定）'
                        : label(value),
                  })),
                ]}
              />
            ) : field.type === 'date' ? (
              <CalendarInput
                autoFocus={index === 0}
                value={values[field.path] ?? ''}
                onChange={(value) => onChange(field.path, value)}
              />
            ) : ['measurement', 'decimal', 'number'].includes(field.type ?? '') ? (
              <DecimalInput
                autoFocus={index === 0}
                min={field.type === 'number' ? '1' : undefined}
                max={field.type === 'number' ? '36500' : undefined}
                step={field.type === 'number' ? '1' : undefined}
                value={values[field.path] ?? ''}
                onChange={(value) => onChange(field.path, value)}
                placeholder="未记录"
              />
            ) : (
              <Input
                autoFocus={index === 0}
                maxLength={field.type === 'list' ? 4096 : 500}
                value={values[field.path] ?? ''}
                onChange={(event) => onChange(field.path, event.target.value)}
                placeholder="未记录"
              />
            )}
          </Field>
          {field.type === 'measurement' && (
            <Field label={`${field.label}单位`}>
              <Select
                value={values[`${field.path}.unit`] ?? field.units?.[0]}
                onChange={(value) => onChange(`${field.path}.unit`, value)}
                options={field.units?.map((value) => ({ value, label: label(value) }))}
              />
            </Field>
          )}
        </Fragment>
      ))}
    </div>
  );
}
