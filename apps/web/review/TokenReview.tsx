import { useEffect, useState, type CSSProperties } from 'react';
import source from '../src/ui/tokens/source.json';
import '../src/ui/theme/vnext.css';
import './review.css';
const sections = ['双色与内容面', '文字与密度', '交互状态', '尺度与面板'] as const;
export function TokenReview({ initialMode = 'daily' }: { initialMode?: 'daily' | 'management' }) {
  const [mode, setMode] = useState(initialMode);
  useEffect(() => setMode(initialMode), [initialMode]);
  const [section, setSection] = useState<number>(0);
  const [name, setName] = useState('厨房收纳盒');
  const [message, setMessage] = useState('');
  const [panel, setPanel] = useState(false);
  return (
    <main className="review" data-acornary-ui="vnext" data-acornary-mode={mode}>
      <header className="review-header">
        <a href="#review-content" className="brand">
          Acornary <span>设计工作台</span>
        </a>
        <span className="review-version">B00 · R1 · 待你审阅</span>
      </header>
      <div className="review-intro">
        <h1>让每一件物品，清楚可见。</h1>
        <p>先确定颜色、文字与尺度。这里是视觉基础样板，所有交互仅在当前预览中生效。</p>
      </div>
      <div className="review-toolbar">
        <fieldset>
          <legend>预览模式</legend>
          {(['daily', 'management'] as const).map((m) => (
            <label key={m}>
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
              {m === 'daily' ? '日常 · 暖陶土' : '管理 · 蓝灰'}
            </label>
          ))}
        </fieldset>
        <p>模式共用事实与语义，仅改变视觉与密度。</p>
      </div>
      <nav aria-label="视觉基础章节">
        {sections.map((s, i) => (
          <button
            type="button"
            key={s}
            aria-current={section === i ? 'page' : undefined}
            onClick={() => setSection(i)}
          >
            {s}
          </button>
        ))}
      </nav>
      <section id="review-content" className="review-content" aria-label={sections[section]}>
        <h2>{sections[section]}</h2>
        {section === 0 && (
          <>
            <p>日常适合轻松浏览，管理适合精确整理。危险、警告、成功与提示在两种模式下保持一致。</p>
            <div className="swatches">
              {Object.entries(source.modes[mode]).map(([key, value]) => (
                <div className="swatch" key={key}>
                  <div aria-hidden="true" style={{ background: value }} />
                  <strong>{key}</strong>
                  <code>{value}</code>
                </div>
              ))}
            </div>
            <h3>共同的语义色</h3>
            <div className="semantic-samples">
              {(['success', 'warning', 'danger', 'info'] as const).map((key, i) => (
                <div
                  key={key}
                  style={{ color: `var(--vn-${key})`, background: `var(--vn-${key}-surface)` }}
                >
                  <strong>{['成功', '需要注意', '错误或危险', '信息提示'][i]}</strong>
                  <p>
                    {['记录已保存', '此项还缺少必要信息', '保存失败，请检查输入', '余量未记录'][i]}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
        {section === 1 && (
          <>
            <p>系统字体，正文易读；少量宋体标题带来温度。数字使用等宽字形，未知事实明确写出。</p>
            <div className="type-specimen">
              <h1>我的物品</h1>
              <h2>厨房里的日常</h2>
              <p>知道放在哪里，也知道哪些还没有记录。</p>
              <small>辅助说明 · 更新于 14:32</small>
            </div>
            <h3>密度样板 · 示例内容</h3>
            <div className="density-row">
              <strong>牛奶 · 1 L</strong>
              <span>厨房 / 冰箱</span>
              <span className="numeric">剩余 310 mL（估计）</span>
            </div>
            <div className="density-row">
              <strong>收纳盒</strong>
              <span>书房 / 下层</span>
              <span>余量未记录</span>
            </div>
            <p>
              当前正文 {mode === 'daily' ? '16' : '14'} px。行最小高度：日常 72 px，管理桌面 56
              px、手机 72 px。手机输入始终至少 16 px。
            </p>
          </>
        )}
        {section === 2 && (
          <>
            <p>这些原生控件用于检验 Token，正式 Button、Input 将在 B01 单独实现与审核。</p>
            <div className="state-samples">
              <button
                type="button"
                className="sample-primary"
                onClick={() => setMessage('已触发样板操作，没有业务写入。')}
              >
                试一下主操作
              </button>
              <button
                type="button"
                className="sample-hover"
                onClick={() => setMessage('悬停色样板已触发。')}
              >
                悬停色
              </button>
              <button
                type="button"
                className="sample-active"
                onClick={() => setMessage('按下色样板已触发。')}
              >
                按下色
              </button>
              <button type="button" disabled>
                不可操作
              </button>
              <button
                type="button"
                className="sample-danger"
                onClick={() => setMessage('危险操作样式预览，没有删除任何数据。')}
              >
                危险操作样板
              </button>
            </div>
            <label className="sample-field">
              物品名称
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-describedby="field-help"
              />
            </label>
            <p id="field-help">可输入长名称，按 Tab 检查焦点。此值仅保留在当前页面。</p>
            <label className="sample-field">
              错误状态
              <input
                aria-invalid="true"
                aria-describedby="field-error"
                defaultValue=""
                placeholder="输入名称"
              />
            </label>
            <p id="field-error" className="sample-error">
              请输入名称后再继续。
            </p>
            <p role="status" className="review-status">
              {message || '点击样板操作后，反馈会出现在这里。'}
            </p>
          </>
        )}
        {section === 3 && (
          <>
            <p>4 px 基础节奏，控件圆角 8 px、面板圆角 12 px。关闭与返回目标至少 44 px。</p>
            <div className="spacing-samples">
              {source.spacingPx.map((n) => (
                <div key={n}>
                  <span>{n} px</span>
                  <i style={{ width: n, height: 24 }} />
                </div>
              ))}
            </div>
            <h3>面板宽度样板</h3>
            <p>
              标准 560 px，复杂操作 720 px；窄容器内保持完整可见。这里展示尺寸，不实现正式模态面板。
            </p>
            <button type="button" onClick={() => setPanel(!panel)} aria-expanded={panel}>
              {' '}
              {panel ? '收起' : '展开'}面板尺寸
            </button>
            {panel && (
              <div
                className="panel-specimen"
                style={{ '--sample-width': 'var(--vn-layout-sheet)' } as CSSProperties}
              >
                <h3>标准面板 · 560 px</h3>
                <p>内容超过高度时，正式面板会保留可达的头部和操作区。B03 审核焦点与关闭行为。</p>
              </div>
            )}
            <p>交互时长 120 / 180 ms；开启系统减少动态效果时归零。</p>
          </>
        )}
      </section>
      <footer>
        <strong>审阅方式</strong>
        <p>在聊天中反馈「B00 / 章节 / 模式 / 问题」，或确认整批。自动测试不会替你批准。</p>
        <small>隔离视觉样板 · 未连接家庭、库存、相机或打印设备</small>
      </footer>
    </main>
  );
}
