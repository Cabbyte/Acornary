import { Input, Select, TreeSelect } from 'antd';
import { Button, Field } from '../../ui/primitives';
import { CalendarInput, DecimalInput } from '../../ui/inputs';
import { Notice } from '../../ui/components';
import { label } from '../../lib/presentation';
import type { WriteFieldsProps, LocationOption } from './types';
import styles from './WriteSheet.module.css';
export function IntakeSheet({
  values,
  onChange: set,
  productOptions,
  categories,
  locations,
  capabilities,
}: WriteFieldsProps & {
  productOptions: Array<{ value: string; label: string; details: string; searchText: string }>;
  categories: Array<{ id: string; name: string }>;
  locations: LocationOption[];
  capabilities: { opening: boolean; expiry: boolean; contents: boolean };
}) {
  return (
    <div className={styles.fields}>
      <>
        <Field label="选择商品">
          <Select
            autoFocus
            showSearch={{
              filterOption: (input, option) =>
                (option?.searchText ?? '').includes(
                  input.normalize('NFKC').trim().toLocaleLowerCase(),
                ),
            }}
            placeholder="搜索名称、品牌、规格或条码"
            optionRender={(option) => (
              <div className="ac-product-option">
                <span>{option.label}</span>
                {option.data.details && <small>{option.data.details}</small>}
              </div>
            )}
            notFoundContent="没有匹配商品，可创建新商品"
            value={values.sku}
            onChange={(e) => set('sku', e)}
            options={[
              { value: '', label: '请选择已有商品', details: '', searchText: '' },
              ...productOptions,
            ]}
          />
        </Field>
        <Button
          htmlType="button"
          onClick={() => set('newProduct', values.newProduct === 'true' ? 'false' : 'true')}
          variant="secondary"
        >
          {values.newProduct === 'true' ? '改用已有商品' : '创建新商品'}
        </Button>
        {values.newProduct === 'true' && (
          <>
            <Notice>新商品先保留为草稿，提交时与实物一起保存。此分类需要已有确认规范。</Notice>
            <Field label="新商品名称">
              <Input
                required
                value={values.productName ?? ''}
                onChange={(e) => set('productName', e.target.value)}
              />
            </Field>
            <Field label="商品分类">
              <Select
                value={values.productParent}
                onChange={(v) => set('productParent', v)}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label="归类依据">
              <Input
                required
                value={values.classificationReason ?? ''}
                onChange={(e) => set('classificationReason', e.target.value)}
                placeholder="说明与已确认分类含义的关系"
              />
            </Field>
          </>
        )}
        <Field label="入库件数" hint="每件实物都有独立身份；以下属性仅应用于这次入库。">
          <DecimalInput
            min="1"
            max="100"
            step="1"
            required
            value={values.count}
            onChange={(value) => set('count', value)}
          />
        </Field>
        <Field label="存放位置">
          <TreeSelect
            showSearch
            treeNodeFilterProp="title"
            treeDefaultExpandAll
            treeDataSimpleMode
            value={values.parent}
            onChange={(value) => set('parent', value ?? '')}
            treeData={[{ id: '', pId: null, value: '', title: '未指定位置' }, ...locations]}
          />
        </Field>
        <details
          className="stash-optional"
          open={!!(values.opening || values.expiry || values.quantity) || undefined}
        >
          <summary>补充日期、开封与余量（可选）</summary>
          <div className="stack">
            {capabilities.opening && (
              <Field label="开封状态">
                <Select
                  value={values.opening}
                  onChange={(e) => set('opening', e)}
                  options={[
                    { value: '', label: '\u672A\u8BB0\u5F55' },
                    { value: 'SEALED', label: '\u672A\u5F00\u5C01' },
                    { value: 'OPENED', label: '\u5DF2\u5F00\u5C01' },
                  ]}
                />
              </Field>
            )}
            {capabilities.expiry && (
              <>
                <Field label="日期类型">
                  <Select
                    value={values.expiry_kind ?? ''}
                    onChange={(v) => set('expiry_kind', v)}
                    options={[
                      { value: '', label: '未记录类型' },
                      { value: 'ESTIMATED', label: '计划吃完（自行设定）' },
                      { value: 'USE_BY', label: '保质期（原包装）' },
                      { value: 'BEST_BEFORE', label: '最佳食用期（原包装）' },
                    ]}
                  />
                </Field>
                <Field label={values.expiry_kind === 'ESTIMATED' ? '计划吃完日期' : '到期日期'}>
                  <CalendarInput value={values.expiry} onChange={(value) => set('expiry', value)} />
                </Field>
              </>
            )}
            {capabilities.contents && (
              <>
                <Field label="每件剩余量" hint="可选，不会自动按包装规格填满。">
                  <DecimalInput
                    value={values.quantity}
                    onChange={(v) => set('quantity', v)}
                    placeholder="未记录"
                  />
                </Field>
                <Field label="每件剩余量单位">
                  <Select
                    value={values.unit}
                    onChange={(v) => set('unit', v)}
                    options={['mL', 'g', 'count', 'percent'].map((value) => ({
                      value,
                      label: label(value),
                    }))}
                  />
                </Field>
              </>
            )}
          </div>
        </details>
      </>
      {capabilities.contents && values.quantity && (
        <Field label="数量依据">
          <Select
            value={values.accuracy}
            onChange={(v) => set('accuracy', v)}
            options={[
              { value: '', label: '未记录' },
              { value: 'ESTIMATED', label: '估计值' },
              { value: 'MEASURED', label: '实测值' },
            ]}
          />
        </Field>
      )}
    </div>
  );
}
