import Markdown from 'react-markdown';
import { FormField } from '../components/ui/form-field';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs } from '../components/ui/tabs';
import { InlineNotice } from '../components/ui/inline-notice';
import { CapabilityNotice } from './capability-notice';
import type { ActionAvailability, NoteView } from './types';
import { cn } from '../components/utils';
import './content.css';

export type NoteDraft = Pick<NoteView, 'title' | 'body'>;
export interface NoteEditorProps {
  itemId: NoteView['itemId'];
  itemLabel: string;
  value: NoteDraft;
  onChange: (value: NoteDraft) => void;
  onSaveIntent?: (value: NoteDraft) => void;
  onCancel?: () => void;
  mode: 'edit' | 'preview';
  onModeChange: (mode: 'edit' | 'preview') => void;
  previewFormat?: 'plain' | 'markdown';
  availability: ActionAvailability;
  dirty: boolean;
  busy?: boolean;
  readOnly?: boolean;
  redacted?: boolean;
  error?: string;
  className?: string;
}
/** react-markdown uses an AST and no raw HTML. Images and links remain inert in this preview.
 * Source: https://github.com/remarkjs/react-markdown#security */
export function NoteEditor({
  itemId,
  itemLabel,
  value,
  onChange,
  onSaveIntent,
  onCancel,
  mode,
  onModeChange,
  previewFormat = 'plain',
  availability,
  dirty,
  busy,
  readOnly,
  redacted,
  error,
  className,
}: NoteEditorProps) {
  const locked =
    readOnly || busy || redacted || value.body === undefined || availability.kind !== 'available';
  const preview = redacted ? (
    <p>备注内容不可见。</p>
  ) : value.body === undefined ? (
    <p>尚未取得备注正文，不能用空白内容覆盖。</p>
  ) : (
    <div className="vn-content-prose">
      {value.title && <h4 className="vn-section-title">{value.title}</h4>}
      {value.body ? (
        previewFormat === 'markdown' ? (
          <Markdown
            skipHtml
            disallowedElements={['img']}
            unwrapDisallowed
            components={{ a: ({ children }) => <span>{children}</span> }}
          >
            {value.body}
          </Markdown>
        ) : (
          <p className="vn-content-value">{value.body}</p>
        )
      ) : (
        <p className="vn-muted">还没有备注内容。</p>
      )}
    </div>
  );
  return (
    <section
      className={cn('vn-content-panel vn-stack', className)}
      aria-label="物品备注"
      aria-busy={busy || undefined}
    >
      <div className="vn-content-header">
        <div>
          <h3 className="vn-section-title">物品备注</h3>
          <p className="vn-content-meta">仅此物品 · {itemLabel}</p>
        </div>
        <Badge>
          {busy ? '正在处理' : readOnly ? '只读' : dirty ? '有未保存修改' : '无未保存修改'}
        </Badge>
      </div>
      <p className="vn-content-meta">记录使用心得或补充说明。备注不会改变数量、日期等属性。</p>
      <details className="vn-content-details">
        <summary>查看备注所属物品</summary>
        <p className="vn-content-meta">物品 ID：{itemId}</p>
      </details>
      {availability.kind !== 'available' && (
        <CapabilityNotice capabilityLabel="编辑备注" availability={availability} />
      )}
      {error && (
        <InlineNotice tone="danger" title="备注尚未保存">
          {error}
        </InlineNotice>
      )}
      {redacted ? (
        <InlineNotice tone="warning" title="备注内容不可见">
          当前权限不允许查看或修改此备注。
        </InlineNotice>
      ) : value.body === undefined ? (
        <InlineNotice tone="warning" title="正文尚未读取">
          原备注仍保留，取得完整内容后才能编辑。
        </InlineNotice>
      ) : (
        <Tabs
          value={mode}
          onValueChange={(next) => {
            if (next === 'edit' || next === 'preview') onModeChange(next);
          }}
          label="备注视图"
          items={[
            {
              value: 'edit',
              label: '编辑',
              content: (
                <div className="vn-stack">
                  <FormField label="标题" hint="选填；清空后表示不设标题。">
                    <Input
                      value={value.title ?? ''}
                      disabled={busy}
                      readOnly={locked}
                      onChange={(event) => {
                        if (!locked) onChange({ ...value, title: event.target.value || null });
                      }}
                    />
                  </FormField>
                  <FormField
                    label="备注内容"
                    hint={
                      previewFormat === 'markdown'
                        ? '支持 Markdown 预览；图片和链接只显示文字。'
                        : '按纯文本预览。'
                    }
                  >
                    <Textarea
                      rows={8}
                      value={value.body}
                      disabled={busy}
                      readOnly={locked}
                      onChange={(event) => {
                        if (!locked) onChange({ ...value, body: event.target.value });
                      }}
                    />
                  </FormField>
                </div>
              ),
            },
            { value: 'preview', label: '预览', content: preview },
          ]}
        />
      )}
      <div className="vn-row">
        {onSaveIntent && (
          <Button
            busy={busy}
            disabled={locked || !dirty}
            onClick={() => {
              if (!locked && dirty) onSaveIntent(value);
            }}
          >
            保存备注
          </Button>
        )}
        {onCancel && (
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {dirty ? '放弃修改' : '关闭'}
          </Button>
        )}
      </div>
    </section>
  );
}
