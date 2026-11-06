import type {
  AttributeBindingV2,
  TemplateDefinitionV2,
  TemplateFieldV2,
} from '../../../../../packages/contracts/src/read-v2';
import { useState } from 'react';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { FormField } from '../components/ui/form-field';
import { Select, type SelectOption } from '../components/ui/select';
import { DateInput } from '../components/ui/date-input';
import { Badge } from '../components/ui/badge';
import { InlineNotice } from '../components/ui/inline-notice';
import { QuantityInput } from './quantity-input';
import { FactSource } from './fact-source';
import { CapabilityNotice } from './capability-notice';
import { LoadingState } from './loading-state';
import { EmptyState } from './empty-state';
import type { ActionAvailability, QuantityPresentation } from './types';
import { cn } from '../components/utils';
import './content.css';

export interface AttributeFieldState {
  kind: 'unknown' | 'unrecorded' | 'mixed' | 'redacted' | 'readOnly';
  reason?: string;
}
/** Presentation drafts only. The caller maps a known field to its real command contract. */
export type AttributeFieldEdit =
  | { path: string; kind: 'value'; value: string | boolean | null }
  | { path: string; kind: 'numberDraft'; text: string }
  | { path: string; kind: 'quantityDraft'; value: QuantityPresentation };
export interface AttributeFieldsProps {
  binding: AttributeBindingV2;
  template: TemplateDefinitionV2 | null;
  scope: { kind: 'ITEM' | 'SKU'; id: string; label: string };
  fieldStates?: Readonly<Record<string, AttributeFieldState>>;
  errors?: Readonly<Record<string, string>>;
  /** Explicit host adapters are required for measurements; no accuracy is inferred. */
  quantities?: Readonly<
    Record<string, { value: QuantityPresentation; units: readonly SelectOption[] }>
  >;
  onChange: (edit: AttributeFieldEdit) => void;
  availability: ActionAvailability;
  readOnly?: boolean;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  calendarMonth: string;
  today?: string | null;
  className?: string;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function atPath(values: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) => (isObject(value) && Object.hasOwn(value, key) ? value[key] : undefined),
      values,
    );
}
function hasUnrecognizedParent(values: Record<string, unknown>, path: string): boolean {
  let current: unknown = values;
  for (const key of path.split('.').slice(0, -1)) {
    if (!isObject(current)) return true;
    if (!Object.hasOwn(current, key)) return false;
    current = current[key];
  }
  return !isObject(current);
}
function retainedPaths(values: Record<string, unknown>, known: Set<string>, prefix = ''): string[] {
  return Object.entries(values).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (known.has(path)) return [];
    if (isObject(value) && Object.keys(value).length) return retainedPaths(value, known, path);
    return [path];
  });
}
function textValue(value: unknown): string {
  if (value === undefined) return '未记录';
  if (value === null) return '已记录为空';
  if (value === '') return '空文本';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? '无法展示的值';
}
const stateLabels = {
  unknown: '值未知',
  unrecorded: '未记录',
  mixed: '多个值',
  redacted: '内容不可见',
  readOnly: '只读',
};

/** Uses existing Base UI fields; metadata comes from the frozen template, never a new schema. */
export function AttributeFields({
  binding,
  template,
  scope,
  fieldStates = {},
  errors = {},
  quantities = {},
  onChange,
  availability,
  readOnly,
  disabled,
  loading,
  error,
  calendarMonth,
  today,
  className,
}: AttributeFieldsProps) {
  const [months, setMonths] = useState<Record<string, string>>({});
  const matching =
    template?.id === binding.template_id && template.version === binding.template_version;
  const scopeMatches =
    template?.target_kind === (scope.kind === 'ITEM' ? 'ITEM' : 'CATALOG_NODE') &&
    (scope.kind !== 'SKU' || template.allowed_catalog_node_kinds.includes('SKU'));
  const editable =
    matching &&
    scopeMatches &&
    binding.status === 'KNOWN' &&
    !readOnly &&
    !disabled &&
    !loading &&
    !error &&
    availability.kind === 'available';
  const fields = matching ? [...template.fields].sort((a, b) => a.order - b.order) : [];
  const known = new Set(fields.map((field) => field.path));
  const extraPaths = [
    ...new Set([
      ...retainedPaths(binding.values, known),
      ...Object.keys(fieldStates).filter((path) => !known.has(path)),
    ]),
  ];
  const stateFor = (path: string) =>
    // A nested redaction also hides an enclosing opaque value. Never stringify its raw object.
    Object.entries(fieldStates).find(
      ([other, state]) =>
        state.kind === 'redacted' &&
        (other === path || path.startsWith(`${other}.`) || other.startsWith(`${path}.`)),
    )?.[1] ??
    fieldStates[path] ??
    Object.entries(fieldStates).find(([parent]) => path.startsWith(`${parent}.`))?.[1];
  const renderField = (field: TemplateFieldV2) => {
    const state = stateFor(field.path);
    const value = atPath(binding.values, field.path);
    const unrecognizedParent = hasUnrecognizedParent(binding.values, field.path);
    const blockedState = state && state.kind !== 'unrecorded';
    const locked = !editable || Boolean(blockedState);
    const change = (next: string | boolean | null) => {
      if (!locked) onChange({ path: field.path, kind: 'value', value: next });
    };
    const validShape =
      value === undefined ||
      value === null ||
      (field.type === 'boolean'
        ? typeof value === 'boolean'
        : field.type === 'number'
          ? typeof value === 'number' || typeof value === 'string'
          : typeof value === 'string');
    const supported = [
      'string',
      'decimal',
      'boolean',
      'date',
      'enum',
      'number',
      'measurement',
    ].includes(field.type);
    const unknownEnum =
      field.type === 'enum' &&
      value != null &&
      !field.options?.some((option) => option.value === value);
    const quantity = quantities[field.path];
    const readValue =
      state?.kind === 'redacted' ||
      state?.kind === 'unknown' ||
      state?.kind === 'mixed' ||
      state?.kind === 'unrecorded'
        ? stateLabels[state.kind]
        : textValue(value);
    if (
      blockedState ||
      unrecognizedParent ||
      !supported ||
      unknownEnum ||
      (field.type === 'measurement' ? !quantity : !validShape)
    )
      return (
        <div className="vn-content-field-read" key={field.path}>
          <div className="vn-row">
            <span className="vn-field-label">{field.label}</span>
            <Badge>{state ? stateLabels[state.kind] : '保留原值'}</Badge>
          </div>
          <div className="vn-content-value">{readValue}</div>
          <p className="vn-content-meta">
            {state?.reason ||
              (unrecognizedParent
                ? '原记录的上层内容无法识别，已保留且暂不可编辑。'
                : unknownEnum
                  ? '当前版本没有此选项，原值保留且暂不可编辑。'
                  : '此字段需要专用编辑入口，原值已保留。')}
          </p>
        </div>
      );
    const common = {
      disabled: disabled || loading,
      readOnly: locked,
      error: errors[field.path],
      hint: field.help,
    };
    return (
      <div className="vn-content-field" key={field.path}>
        {field.type === 'measurement' && quantity ? (
          <QuantityInput
            value={quantity.value}
            units={quantity.units}
            label={field.label}
            {...common}
            onChange={(next) => {
              if (!locked) onChange({ path: field.path, kind: 'quantityDraft', value: next });
            }}
          />
        ) : field.type === 'date' ? (
          <DateInput
            {...common}
            label={field.label}
            value={typeof value === 'string' ? value : null}
            onValueChange={change}
            month={months[field.path] ?? calendarMonth}
            onMonthChange={(month) => setMonths((current) => ({ ...current, [field.path]: month }))}
            today={today}
          />
        ) : field.type === 'boolean' ? (
          <Select
            {...common}
            label={field.label}
            value={typeof value === 'boolean' ? String(value) : null}
            options={[
              { value: 'true', label: '是' },
              { value: 'false', label: '否' },
            ]}
            placeholder="未记录"
            onValueChange={(next) => change(next === null ? null : next === 'true')}
          />
        ) : field.type === 'enum' ? (
          <Select
            {...common}
            label={field.label}
            value={typeof value === 'string' ? value : null}
            options={field.options ?? []}
            placeholder="未记录"
            onValueChange={change}
          />
        ) : (
          <FormField
            label={field.unit ? `${field.label}（${field.unit}）` : field.label}
            hint={field.help}
            error={errors[field.path]}
          >
            {field.widget === 'textarea' ? (
              <Textarea
                value={typeof value === 'string' ? value : ''}
                disabled={common.disabled}
                readOnly={locked}
                onChange={(event) => change(event.target.value)}
                placeholder="未记录"
              />
            ) : (
              <Input
                value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
                inputMode={
                  field.type === 'number' || field.type === 'decimal' ? 'decimal' : undefined
                }
                disabled={common.disabled}
                readOnly={locked}
                placeholder="未记录"
                onChange={(event) => {
                  if (locked) return;
                  if (field.type === 'number')
                    onChange({ path: field.path, kind: 'numberDraft', text: event.target.value });
                  else change(event.target.value);
                }}
              />
            )}
          </FormField>
        )}
        {value === null && <span className="vn-content-meta">当前已记录为空。</span>}
      </div>
    );
  };
  return (
    <section
      className={cn('vn-content-panel vn-stack', className)}
      aria-label="属性字段"
      aria-busy={loading || undefined}
    >
      <div className="vn-content-header">
        <div>
          <h3 className="vn-section-title">{matching ? template.name : '属性记录'}</h3>
          <p className="vn-content-meta">
            {scope.kind === 'SKU' ? '同一商品共享' : '仅此物品'} · {scope.label}
          </p>
        </div>
        <Badge>版本 {binding.template_version}</Badge>
      </div>
      <details className="vn-content-details">
        <summary>查看记录范围</summary>
        <p className="vn-content-meta">
          {scope.kind === 'SKU' ? '商品' : '物品'} ID：{scope.id}
        </p>
        <FactSource
          source={{ templateId: binding.template_id, version: binding.template_version, path: '*' }}
          templateName={template?.name}
        />
      </details>
      {availability.kind !== 'available' && (
        <CapabilityNotice capabilityLabel="编辑属性" availability={availability} />
      )}
      {readOnly && <p className="vn-content-meta">当前属性为只读。</p>}
      {(!matching || !scopeMatches || binding.status !== 'KNOWN') && (
        <InlineNotice tone="warning" title="保留现有属性">
          {!matching
            ? '尚未取得相同版本的属性说明。'
            : !scopeMatches
              ? '此属性说明不适用于当前对象范围。'
              : binding.status === 'RETIRED'
                ? '此属性版本已停用。'
                : '尚不能识别此属性。'}
          原有内容保持只读。
        </InlineNotice>
      )}
      {loading ? (
        <LoadingState layout="compact" label="正在读取属性说明" />
      ) : (
        <>
          {error && (
            <InlineNotice tone="danger" title="属性读取失败">
              {error}
            </InlineNotice>
          )}
          <div className="vn-content-fields">{fields.map(renderField)}</div>
          {extraPaths.length > 0 && (
            <div className="vn-stack">
              <h4 className="vn-section-title">保留的其他内容</h4>
              <p className="vn-content-meta">
                这些内容未提供可编辑说明。修改其他字段不会移除它们。
              </p>
              {extraPaths.map((path) => {
                const state = stateFor(path);
                return (
                  <div className="vn-content-field-read" key={path}>
                    <span className="vn-field-label">{path}</span>
                    <div className="vn-content-value">
                      {state && state.kind !== 'readOnly'
                        ? stateLabels[state.kind]
                        : textValue(atPath(binding.values, path))}
                    </div>
                    {state?.reason && <span className="vn-content-meta">{state.reason}</span>}
                  </div>
                );
              })}
            </div>
          )}
          {!error && !fields.length && !extraPaths.length && (
            <EmptyState
              reason="empty"
              title="暂无属性内容"
              context="当前记录没有可展示的属性字段。"
            />
          )}
        </>
      )}
    </section>
  );
}
