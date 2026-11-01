import { Input, Select } from 'antd';
import { Field } from '../../ui/primitives';
import type { WriteFieldsProps } from './types';
import styles from './WriteSheet.module.css';

/** Fields only: the shared write controller owns the persisted attempt and recovery. */
export function ConsumeSheet({
  values,
  onChange,
  unit,
  error,
  preview,
}: WriteFieldsProps & {
  unit?: string;
  error?: string;
  preview?: string;
}) {
  return (
    <div className={styles.fields}>
      <Field
        label="本次消耗量"
        required
        error={values.amount ? error : undefined}
        hint={`单位：${unit || '未记录'}。应大于 0，且不超过当前剩余量。`}
      >
        <Input
          autoFocus
          inputMode="decimal"
          maxLength={100}
          pattern="(0|[1-9][0-9]*)(\.[0-9]+)?"
          value={values.amount}
          onChange={(e) => onChange('amount', e.target.value)}
        />
      </Field>
      <Field label="数量依据">
        <Select
          value={values.accuracy}
          onChange={(value) => onChange('accuracy', value)}
          options={[
            { value: '', label: '未记录' },
            { value: 'ESTIMATED', label: '估计值' },
            { value: 'MEASURED', label: '实测值' },
          ]}
        />
      </Field>
      <section className={styles.preview} aria-live="polite">
        <span>使用后剩余</span>
        <strong>{preview || '填写消耗量后预览'}</strong>
      </section>
    </div>
  );
}
