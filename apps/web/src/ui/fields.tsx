import { CalendarInput, DecimalInput } from './inputs';
import { Input, Select } from 'antd';
import type { TemplateId } from '../../../../packages/contracts/src/index';
import { label } from '../lib/presentation';
import { FormField } from './components';
export interface Definition {
  path: string;
  label: string;
  type?: 'date' | 'number' | 'decimal' | 'measurement' | 'list';
  options?: string[];
  units?: string[];
}
export const definitions: Partial<Record<TemplateId, Definition[]>> = {
  product: [
    { path: 'brand', label: '品牌' },
    { path: 'model', label: '型号' },
    { path: 'specification', label: '包装规格' },
    { path: 'net_content', label: '包装净含量', type: 'measurement', units: ['mL', 'g', 'count'] },
    { path: 'barcodes', label: '商品条码', type: 'list' },
    {
      path: 'storage.requirement',
      label: '保存要求',
      options: ['AMBIENT', 'REFRIGERATED', 'FROZEN'],
    },
  ],
  lifecycle: [
    { path: 'expiry.date', label: '到期日期', type: 'date' },
    {
      path: 'expiry.date_kind',
      label: '日期类型',
      options: ['BEST_BEFORE', 'USE_BY', 'ESTIMATED'],
    },
    { path: 'expiry.after_opening_days', label: '开封后保质天数', type: 'number' },
    {
      path: 'availability',
      label: '可用状态',
      options: ['AVAILABLE', 'IN_USE', 'LOANED', 'CLEANING', 'MAINTENANCE', 'IN_TRANSIT'],
    },
    { path: 'condition', label: '物品状况', options: ['NEW', 'GOOD', 'WORN', 'DAMAGED', 'BROKEN'] },
    { path: 'acquisition.acquired_on', label: '购入日期', type: 'date' },
    { path: 'acquisition.batch_label', label: '批次名称' },
  ],
  contents: [
    {
      path: 'remaining',
      label: '剩余内容',
      type: 'measurement',
      units: ['mL', 'g', 'count', 'percent'],
    },
    { path: 'accuracy', label: '数量依据', options: ['ESTIMATED', 'MEASURED'] },
  ],
  clothing: [
    { path: 'material', label: '材质' },
    { path: 'color', label: '颜色' },
    { path: 'size', label: '尺码' },
  ],
  device: [
    { path: 'connector', label: '接口' },
    { path: 'rated_power_w', label: '额定功率（W）', type: 'decimal' },
  ],
};
export const templateLabels: Partial<Record<TemplateId, string>> = {
  product: '商品共有资料',
  lifecycle: '状态与日期',
  contents: '剩余内容',
  clothing: '衣物资料',
  device: '设备资料',
};
export const correctionFields: Definition[] = [
  {
    path: 'state',
    label: '生命周期',
    options: ['ACTIVE', 'CONSUMED', 'DISPOSED', 'LOST', 'ARCHIVED'],
  },
  { path: 'opening.state', label: '开封状态', options: ['SEALED', 'OPENED'] },
];
export type Values = Record<string, string>;
export const valueAt = (object: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      object,
    );
export function fieldValues(object: unknown, fields: Definition[]): Values {
  const out: Values = {};
  for (const f of fields) {
    const v = valueAt(object, f.path);
    if (f.type === 'measurement') {
      out[f.path] = String(
        (
          v as {
            value?: string;
          }
        )?.value ?? '',
      );
      out[`${f.path}.unit`] = String(
        (
          v as {
            unit?: string;
          }
        )?.unit ??
          f.units?.[0] ??
          'mL',
      );
    } else out[f.path] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
  }
  return out;
}
export function changes(values: Values, original: Values, fields: Definition[]) {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const f of fields) {
    const v = values[f.path]?.trim() ?? '';
    if (
      v === (original[f.path] ?? '') &&
      (f.type !== 'measurement' || values[`${f.path}.unit`] === original[`${f.path}.unit`])
    )
      continue;
    if (!v) {
      unset.push(f.path);
      continue;
    }
    set[f.path] =
      f.type === 'measurement'
        ? { value: v, unit: values[`${f.path}.unit`] }
        : f.type === 'number'
          ? Number(v)
          : f.type === 'list'
            ? v
                .split(/[,，\n]/)
                .map((s) => s.trim())
                .filter(Boolean)
            : v;
  }
  return { set, unset };
}
export function nested(flat: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    let o = result;
    const parts = key.split('.');
    for (const part of parts.slice(0, -1)) {
      o[part] ??= {};
      o = o[part] as Record<string, unknown>;
    }
    o[parts.at(-1)!] = value;
  }
  return result;
}
export function AttributeFields({
  fields,
  values,
  onChange,
}: {
  fields: Definition[];
  values: Values;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <>
      {fields.map((f) => (
        <FormField
          key={f.path}
          label={f.label}
          hint={f.type === 'list' ? '多个条码用逗号分隔；留空表示未记录' : undefined}
        >
          {f.options ? (
            <Select
              value={values[f.path] ?? ''}
              onChange={(value) => onChange(f.path, value)}
              options={[
                { value: '', label: '未记录' },
                ...f.options.map((o) => ({
                  value: o,
                  label:
                    f.path === 'expiry.date_kind' && o === 'ESTIMATED'
                      ? '计划吃完（自行设定）'
                      : label(o),
                })),
              ]}
            />
          ) : f.type === 'measurement' ? (
            <span className="measurement">
              <DecimalInput
                aria-label={f.label}
                value={values[f.path] ?? ''}
                onChange={(value) => onChange(f.path, value)}
                placeholder="未记录"
              />
              <Select
                aria-label={`${f.label}单位`}
                value={values[`${f.path}.unit`] ?? f.units?.[0]}
                onChange={(value) => onChange(`${f.path}.unit`, value)}
                options={f.units?.map((u) => ({ value: u, label: label(u) }))}
              />
            </span>
          ) : f.type === 'date' ? (
            <CalendarInput
              value={values[f.path] ?? ''}
              onChange={(value) => onChange(f.path, value)}
            />
          ) : f.type === 'number' || f.type === 'decimal' ? (
            <DecimalInput
              min={f.type === 'number' ? '1' : undefined}
              max={f.type === 'number' ? '36500' : undefined}
              step={f.type === 'number' ? '1' : undefined}
              value={values[f.path] ?? ''}
              onChange={(value) => onChange(f.path, value)}
              placeholder="未记录"
            />
          ) : (
            <Input
              maxLength={f.type === 'list' ? 4096 : 500}
              value={values[f.path] ?? ''}
              onChange={(e) => onChange(f.path, e.target.value)}
              placeholder="未记录"
            />
          )}
        </FormField>
      ))}
    </>
  );
}
