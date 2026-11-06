import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './review-frame.css';

const NotesTarget = createContext<HTMLDivElement | null>(null);

/** Review-only chrome. Teaching and adapter notes stay outside the product canvas. */
export function ReviewFrame({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  return (
    <NotesTarget.Provider value={target}>
      <div className="review-frame">
        <div className="review-environment">预览 · 示例数据</div>
        <div className="review-canvas">{children}</div>
        <details className="review-guidance">
          <summary>审阅说明</summary>
          <p>
            此预览只改变本页示例，不连接库存、账号或设备。切换配色、模式和宽度会保留输入；刷新或切换场景会重置示例。
          </p>
          <div ref={setTarget} />
        </details>
      </div>
    </NotesTarget.Provider>
  );
}

export function ReviewNote({ children }: { children: ReactNode }) {
  const target = useContext(NotesTarget);
  return target
    ? createPortal(<div className="review-guidance-note">{children}</div>, target)
    : null;
}

export function ReviewFeedback({ children }: { children: ReactNode }) {
  if (!children || (typeof children === 'string' && /^(尚未|暂无|本地点击：0)/.test(children)))
    return null;
  return (
    <p className="review-feedback" role="status">
      {children}
    </p>
  );
}
