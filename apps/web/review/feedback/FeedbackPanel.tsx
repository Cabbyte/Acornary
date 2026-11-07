import { useEffect, useId, useState } from 'react';
import { Button } from '../../src/ui/components/ui/button';
import { Textarea } from '../../src/ui/components/ui/textarea';
import type { FeedbackContext, FeedbackRecord } from './types';
import './feedback.css';
import resolutionData from './resolutions.json';
const resolutions: Record<string, { status: string; version: string; summary: string }> =
  resolutionData;

const drafts = new Map<string, string>();
type Pending = FeedbackContext & { id: string; text: string };
const pendingDrafts = new Map<string, Pending>();
export function FeedbackPanel({ context }: { context: FeedbackContext }) {
  const key = `${context.component}:${context.scenario}`;
  // Keyed editor prevents a late response for another page from changing this draft.
  return <FeedbackEditor key={key} context={context} draftKey={key} />;
}
function FeedbackEditor({ context, draftKey }: { context: FeedbackContext; draftKey: string }) {
  const id = useId();
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(`acornary-feedback:${draftKey}`) || drafts.get(draftKey) || '';
    } catch {
      return drafts.get(draftKey) || '';
    }
  });
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);
  const [pending, setPending] = useState<Pending | null>(() => {
    try {
      const value = localStorage.getItem(`acornary-feedback-pending:${draftKey}`);
      return value ? JSON.parse(value) : pendingDrafts.get(draftKey) || null;
    } catch {
      return pendingDrafts.get(draftKey) || null;
    }
  });
  const [draftWarning, setDraftWarning] = useState('');
  const remember = (value: string) => {
    setText(value);
    drafts.set(draftKey, value);
    try {
      localStorage.setItem(`acornary-feedback:${draftKey}`, value);
    } catch {
      setDraftWarning('浏览器无法保存草稿，请提交后再刷新。');
    }
  };
  const refresh = async () => {
    try {
      const response = await fetch('/__review/feedback', { cache: 'no-store' });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
        throw Error();
      const data = await response.json();
      setRecords(data.records);
      setError('');
    } catch {
      setError('无法读取本地意见。请使用运行中的 6007 或 6006 开发预览，稍后重试。');
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  async function submit() {
    if (busy || !text.trim()) return;
    const request = pending || { ...context, id: crypto.randomUUID(), text: text.trim() };
    setPending(request);
    pendingDrafts.set(draftKey, request);
    try {
      localStorage.setItem(`acornary-feedback-pending:${draftKey}`, JSON.stringify(request));
    } catch {
      setError('无法持久保存提交记录。请允许本地存储后重试；尚未发送。');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/__review/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '保存失败，请重试。');
      setRecords((current) => [result.record, ...current.filter((r) => r.id !== result.record.id)]);
      remember('');
      setPending(null);
      pendingDrafts.delete(draftKey);
      localStorage.removeItem(`acornary-feedback-pending:${draftKey}`);
      setMessage('已保存到本地审阅记录。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存结果未确认，请重试。');
    } finally {
      setBusy(false);
    }
  }
  const visible = records.filter((r) => all || r.component === context.component);
  return (
    <details className="review-comments">
      <summary>
        修改意见{' '}
        <span>{records.filter((r) => r.component === context.component).length || ''}</span>
      </summary>
      <div className="review-comments-body">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={id}>
            {context.name} · {context.scenario}
          </label>
          <Textarea
            id={id}
            value={text}
            maxLength={8000}
            rows={3}
            readOnly={busy || Boolean(pending)}
            placeholder="哪里需要修改？希望改成什么样？"
            onChange={(event) => {
              remember(event.target.value);
              setMessage('');
            }}
          />
          <div className="review-comments-actions">
            <span>
              {context.version} · {context.preset} / {context.mode} · {context.viewport}px
            </span>
            <Button type="submit" busy={busy} disabled={!text.trim()}>
              {pending && !busy ? '重试保存' : '提交意见'}
            </Button>
          </div>
          <p className="review-comments-hint">
            自动记录当前页面和外观。意见供后续修改参考，不代表批准设计。
          </p>
          {draftWarning && <p role="status">{draftWarning}</p>}
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
        </form>
        <div className="review-comments-actions">
          <label>
            <input
              type="checkbox"
              checked={all}
              onChange={(event) => setAll(event.target.checked)}
            />{' '}
            全部页面意见
          </label>
          <Button variant="quiet" onClick={() => void refresh()}>
            刷新记录
          </Button>
        </div>
        <div className="review-comments-history">
          {visible.length === 0 ? (
            <p className="review-comments-hint">暂无已提交意见。</p>
          ) : (
            visible.map((record) => (
              <article key={record.id}>
                <strong>{record.name}</strong>
                <span className="review-comments-hint">
                  {' '}
                  · {record.scenario} · {record.preset}/{record.mode} · {record.viewport}px ·{' '}
                  {record.version}
                </span>
                <p>{record.text}</p>
                {resolutions[record.id] && (
                  <div className="review-comments-resolution">
                    <strong>
                      {resolutions[record.id].version} · {resolutions[record.id].status}
                    </strong>
                    <p>{resolutions[record.id].summary}</p>
                  </div>
                )}
                <time dateTime={record.createdAt}>
                  {new Date(record.createdAt).toLocaleString('zh-CN')}
                </time>
              </article>
            ))
          )}
        </div>
      </div>
    </details>
  );
}
