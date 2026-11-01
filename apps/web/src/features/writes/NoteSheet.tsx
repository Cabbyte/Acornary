import { Input } from 'antd';
import { Field } from '../../ui/primitives';
import type { WriteFieldsProps } from './types';
import styles from './WriteSheet.module.css';

export function NoteSheet({ values, onChange }: WriteFieldsProps) {
  return (
    <div className={styles.fields}>
      <Field label="笔记标题" hint="可选，用一句话概括。">
        <Input
          autoFocus
          maxLength={500}
          value={values.title}
          onChange={(e) => onChange('title', e.target.value)}
        />
      </Field>
      <Field label="笔记内容" required hint="支持 Markdown。保存后可在物品档案查看。">
        <Input.TextArea
          rows={8}
          maxLength={100000}
          value={values.body}
          onChange={(e) => onChange('body', e.target.value)}
        />
      </Field>
    </div>
  );
}
