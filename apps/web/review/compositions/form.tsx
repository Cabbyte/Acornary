import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '../../src/ui/components/ui/button';
import { FormField } from '../../src/ui/components/ui/form-field';
import { Input } from '../../src/ui/components/ui/input';
import { InlineNotice } from '../../src/ui/components/ui/inline-notice';
import { PageHeader } from '../../src/ui/patterns/page-header';
import { ReviewNote } from '../review-frame';
import { isPlainDate } from '../../src/ui/components/ui/calendar';
import { QuantityInput, validateQuantityDraft } from '../../src/ui/patterns/quantity-input';
import { DateFactField } from '../../src/ui/patterns/date-fact-field';
import { LocationPicker, type LocationSelection } from '../../src/ui/patterns/location-picker';
import type { DateFactPresentation } from '../../src/ui/patterns/types';
import type { ReviewDemoProps } from '../types';
import { fridgeId } from '../fixtures';
const schema = z.object({
  name: z.string().trim().min(1, '请填写物品名称。'),
  quantity: z
    .object({
      value: z.string().nullable(),
      unit: z.string(),
      accuracy: z.enum(['measured', 'estimated', 'unknown']),
    })
    .superRefine((v, ctx) => {
      const message = validateQuantityDraft(v, '0', '1000');
      if (message) ctx.addIssue({ code: 'custom', message });
    }),
  dueOn: z
    .string()
    .nullable()
    .refine((v) => !v || isPlainDate(v), '请检查日期是否完整、有效。'),
});
type Fields = z.infer<typeof schema>;
const fact: DateFactPresentation = {
  kind: 'EXPIRY',
  dateKind: 'BEST_BEFORE',
  dueOn: null,
  basis: null,
  state: 'UNKNOWN',
  source: 'LIFECYCLE',
  label: '最佳食用期',
};
export function FormComposition({ scenario }: ReviewDemoProps) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    trigger,
    formState: { errors, isDirty },
  } = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '燕麦饮',
      quantity: { value: '310.0', unit: 'mL', accuracy: 'estimated' },
      dueOn: null,
    },
  });
  const [date, setDate] = useState(fact);
  const [month, setMonth] = useState('2026-11');
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState<LocationSelection>({ kind: 'unknown' });
  const [message, setMessage] = useState('');
  useEffect(() => {
    reset({
      name: scenario === 'errors' ? '' : '燕麦饮',
      quantity: {
        value: scenario === 'unknown' ? null : scenario === 'errors' ? '1001' : '310.0',
        unit: 'mL',
        accuracy: scenario === 'unknown' ? 'unknown' : 'estimated',
      },
      dueOn: scenario === 'errors' ? '2026-02-30' : null,
    });
    setDate(fact);
    setLocation({ kind: 'unknown' });
    setMessage('');
    if (scenario === 'errors') void trigger();
  }, [scenario, reset, trigger]);
  const readonly = scenario === 'readonly';
  const hasChanges =
    isDirty ||
    location.kind !== 'unknown' ||
    date.basis !== fact.basis ||
    date.dateKind !== fact.dateKind;
  return (
    <div className="vn-stack review-composition review-composition--form">
      <PageHeader title="物品资料" />
      <ReviewNote>核对只验证当前草稿，不保存库存。使用“还原示例”清空本次改动。</ReviewNote>
      <form
        noValidate
        className="vn-stack"
        onSubmit={handleSubmit(() => setMessage('草稿已通过本地校验。没有发送或保存库存记录。'))}
      >
        <div className="review-form-grid">
          <FormField
            label="物品名称"
            required
            error={errors.name?.message}
            hint={
              scenario === 'alignment'
                ? '用于辨认这一件物品；此说明可展开，不改变字段的对齐基准。'
                : undefined
            }
          >
            <Input {...register('name')} readOnly={readonly} />
          </FormField>
          <LocationPicker
            value={location}
            onValueChange={setLocation}
            query={query}
            onQueryChange={setQuery}
            candidates={
              '厨房 冰箱'.includes(query)
                ? [
                    {
                      itemId: fridgeId,
                      name: '冰箱',
                      path: ['厨房', '冰箱'],
                      eligibility: { kind: 'validContainer' },
                      source: '当前家庭位置资料',
                    },
                  ]
                : []
            }
            rootPolicy={{ allowed: true }}
            unknownPolicy={{ allowed: true }}
            readOnly={readonly}
          />
          <Controller
            control={control}
            name="quantity"
            render={({ field }) => (
              <QuantityInput
                value={field.value}
                onChange={field.onChange}
                units={[{ value: 'mL', label: 'mL' }]}
                maximum="1000"
                minimum="0"
                readOnly={readonly}
                error={errors.quantity?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="dueOn"
            render={({ field }) => (
              <DateFactField
                fact={{ ...date, dueOn: field.value }}
                onChange={(next) => {
                  setDate(next);
                  field.onChange(next.dueOn);
                }}
                timezone={scenario === 'unknown' ? null : 'Asia/Shanghai'}
                month={month}
                onMonthChange={setMonth}
                today="2026-11-06"
                readOnly={readonly}
                error={errors.dueOn?.message}
              />
            )}
          />
        </div>
        <div className="vn-row review-form-actions">
          <Button type="submit" disabled={readonly}>
            核对草稿
          </Button>
          <Button
            variant="quiet"
            disabled={readonly}
            onClick={() => {
              reset();
              setDate(fact);
              setLocation({ kind: 'unknown' });
              setMessage('示例已还原。');
            }}
          >
            还原示例
          </Button>
          <span className="vn-muted">{hasChanges ? '有未保存输入' : ''}</span>
        </div>
      </form>
      {message && (
        <InlineNotice tone="info" title="预览反馈">
          {message}
        </InlineNotice>
      )}
    </div>
  );
}
