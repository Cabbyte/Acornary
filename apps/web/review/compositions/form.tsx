import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '../../src/ui/components/ui/button';
import { FormField } from '../../src/ui/components/ui/form-field';
import { Input } from '../../src/ui/components/ui/input';
import { InlineNotice } from '../../src/ui/components/ui/inline-notice';
import { Separator } from '../../src/ui/components/ui/separator';
import { isPlainDate } from '../../src/ui/components/ui/calendar';
import { QuantityInput, validateQuantityDraft } from '../../src/ui/patterns/quantity-input';
import { DateFactField } from '../../src/ui/patterns/date-fact-field';
import { LocationPicker, type LocationSelection } from '../../src/ui/patterns/location-picker';
import { DraftStatus } from '../../src/ui/patterns/draft-status';
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
  return (
    <div className="vn-stack review-composition">
      <div>
        <h2 className="vn-section-title">小型物品表单</h2>
        <p className="vn-muted">
          测试数据 · 审阅字段组合、错误位置和操作层级。核对仅在当前页面生效。
        </p>
      </div>
      <form
        noValidate
        className="vn-stack"
        onSubmit={handleSubmit(() => setMessage('草稿已通过本地校验。没有发送或保存库存记录。'))}
      >
        <FormField label="这一件物品的名称" required error={errors.name?.message}>
          <Input {...register('name')} readOnly={readonly} />
        </FormField>
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
        <Separator />
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
        <Separator />
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
        <div className="vn-row">
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
          <span className="vn-muted">{isDirty ? '有未保存输入' : '当前示例'}</span>
        </div>
      </form>
      {message && (
        <InlineNotice tone="info" title="预览反馈">
          {message}
        </InlineNotice>
      )}
      <DraftStatus
        taskId="preview-form-01"
        scopeLabel="示例家庭 · 这一件燕麦饮"
        state="inMemory"
        reason="预览草稿仅保留在当前页面。切换配色、模式或宽度会保留输入；刷新或切换场景会还原。"
      />
    </div>
  );
}
