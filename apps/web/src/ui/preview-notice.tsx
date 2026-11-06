export function PreviewNotice() {
  if (import.meta.env.VITE_ACORNARY_ENV !== 'preview') return null;
  return (
    <div
      role="status"
      style={{
        padding: '8px 16px',
        background: '#fff3d6',
        color: '#654600',
        fontSize: 12,
        lineHeight: 1.5,
        textAlign: 'center',
      }}
    >
      Cloudflare 测试版 · 数据独立于正式版
    </div>
  );
}
