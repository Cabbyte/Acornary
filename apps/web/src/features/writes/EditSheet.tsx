import { Input } from 'antd';
import { useState } from 'react';
import { Button, Field } from '../../ui/primitives';
import { CalendarInput } from '../../ui/inputs';
import { label } from '../../lib/presentation';
import type { WriteFieldsProps } from './types';
import styles from './WriteSheet.module.css';

export function EditSheet({
  values,
  onChange,
  productName,
  specification,
}: WriteFieldsProps & {
  productName: string;
  specification: string;
}) {
  const [tab, setTab] = useState<'item' | 'catalog'>('item');
  return (
    <div className={styles.fields}>
      <div className={styles.tabs} role="tablist" aria-label="编辑范围">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'item'}
          onClick={() => setTab('item')}
        >
          这件物品
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'catalog'}
          onClick={() => setTab('catalog')}
        >
          商品共有资料
        </button>
      </div>
      {tab === 'item' ? (
        <div role="tabpanel" className={styles.fields}>
          <p className={styles.hint}>名称、购入日期与备注只属于这件实物。</p>
          <Field label="名称" hint="留空时使用商品名称。">
            <Input
              autoFocus
              maxLength={500}
              value={values.name}
              placeholder={productName}
              onChange={(e) => onChange('name', e.target.value)}
            />
          </Field>
          <Field label="状态" hint="已记录的状态，仅供查阅。">
            <Input readOnly value={label(values.availability)} />
          </Field>
          <Field label="购入日期">
            <CalendarInput
              value={values.acquired_on}
              onChange={(v) => onChange('acquired_on', v)}
            />
          </Field>
          <Field label="备注">
            <Input.TextArea
              rows={4}
              maxLength={100000}
              value={values.body}
              onChange={(e) => onChange('body', e.target.value)}
            />
          </Field>
        </div>
      ) : (
        <div role="tabpanel" className={styles.fields}>
          <p className={styles.hint}>
            商品共有资料影响所有同款实物。请保存本次修改后，在商品目录单独编辑。
          </p>
          <Field label="商品名称">
            <Input readOnly value={productName} />
          </Field>
          <Field label="规格">
            <Input readOnly value={specification || '未记录'} />
          </Field>
          <Button variant="quiet" onClick={() => setTab('item')}>
            返回这件物品
          </Button>
        </div>
      )}
    </div>
  );
}
