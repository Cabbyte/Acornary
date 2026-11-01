import { TreeSelect } from 'antd';
import { Field } from '../../ui/primitives';
import type { LocationOption, WriteFieldsProps } from './types';
import styles from './WriteSheet.module.css';

export function MoveSheet({
  values,
  onChange,
  locations,
  currentPaths,
  error,
}: WriteFieldsProps & {
  locations: LocationOption[];
  currentPaths: string[];
  error?: string;
}) {
  const destination = locations.find((location) => location.value === values.parent)?.title;
  return (
    <div className={styles.fields}>
      <section className={styles.context}>
        <span>当前位置</span>
        <ul>
          {currentPaths.map((path, index) => (
            <li key={index}>{path}</li>
          ))}
        </ul>
      </section>
      <Field
        label="目标位置"
        required
        hint="搜索位置名称或展开位置树。移动整件实物。"
        error={values.destinationChosen === 'true' ? error : undefined}
      >
        <TreeSelect
          autoFocus
          showSearch
          treeNodeFilterProp="title"
          treeDefaultExpandAll
          treeDataSimpleMode
          placeholder="选择目标位置"
          value={values.destinationChosen === 'true' ? values.parent : undefined}
          treeData={[{ id: '', pId: null, value: '', title: '未指定位置' }, ...locations]}
          onChange={(value) => {
            onChange('parent', value);
            onChange('destinationChosen', 'true');
          }}
        />
      </Field>
      <section className={styles.preview} aria-live="polite">
        <span>确认移至</span>
        <strong>
          {values.destinationChosen === 'true' ? destination || '未指定位置' : '尚未选择'}
        </strong>
      </section>
    </div>
  );
}
