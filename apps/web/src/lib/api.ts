import type { SnapshotV2 } from '../../../../packages/contracts/src/read-v2.js';
import { beginCall, type CallTiming } from './timing.js';
import { embeddedRuntime } from './runtime.js';
import type { Operation } from '../../../../packages/contracts/src/index.js';
import type { HistoryEvent, WriteResult } from '../../../../packages/contracts/src/web.js';
import { PROTOCOL_HEADER, PROTOCOL_VERSION } from '../features/api/protocol.js';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
    public details?: unknown,
    public request_id?: string,
    public recovery?: string,
  ) {
    super(message);
  }
}
export const messages: Record<string, string> = {
  POLICY_REQUIRED: '此分类尚未建立规范。请在对话中提出具体规则，并在确认卡片核对。',
  POLICY_CONFLICT: '分类规范已更新，请重新核对入库方案。',
  CLASSIFICATION_CONFLICT: '归类与已确认规则冲突，请核对相关分类。',
  AMBIGUOUS_PRODUCT: '找到可能的同款，请核对商品差异。',
  APPROVAL_REQUIRED: '请先在确认卡片批准具体变更。',
  APPROVAL_EXPIRED: '确认卡片已过期或身份改变，请重新打开。',
  MISSING_EXPECTED_REVISION: '缺少记录版本。请读取目标记录后再提交。',
  REVISION_CONFLICT: '记录已发生变化。请核对最新内容后重新提交。',
  IDEMPOTENCY_CONFLICT: '这次操作的重试信息不一致，请重新核对。',
  SESSION_CHANGED: '连接账号、家庭或授权已改变，请重新打开操作。',
  UNAUTHORIZED: '登录已失效，输入已保留。请重新登录后继续。',
  FORBIDDEN: '当前账号无法执行此操作。',
  NOT_FOUND: '这条记录已不可用，请刷新查看。',
  ATTRIBUTE_VALIDATION_FAILED: '请检查输入格式和字段范围。',
  INVALID_PARENT: '请选择有效的位置或分类。',
  CYCLE_DETECTED: '不能移入自身或自己的下级。',
  MISSING_FACTS: '请先记录剩余量，再进行消耗。',
  INSUFFICIENT_CONTENT: '消耗量不能大于当前剩余量。',
  UNIT_MISMATCH: '单位与当前剩余量不一致。',
  INVALID_TRANSITION: '当前状态不能执行此操作，请刷新核对。',
  BARCODE_CONFLICT: '该条码已被其他商品使用。',
  TEMPLATE_IN_USE: '这项资料正在使用，不能移除。',
  PROTOCOL_VERSION_UNSUPPORTED: '当前客户端版本过旧，请刷新或升级后再操作。',
  INVALID_CURSOR: '列表已更新，请从第一页重新查看。',
  CURSOR_STALE: '导出的列表已过期，请重新开始。',
  ATTACHMENT_TOO_LARGE: '文件超过 25 MiB，请压缩后重试。',
  ATTACHMENT_QUOTA_EXCEEDED: '家庭附件空间已满（5 GiB），请先删除旧附件。',
  ATTACHMENT_TYPE_UNSUPPORTED: '只支持 JPEG、PNG、WebP 或 PDF。',
  ATTACHMENT_TRANSPORT_UNSUPPORTED: '插件无法上传或下载附件，请在松仓网站中使用。',
  REFERENCE_INVALID: '关联的对象不存在或不可用。',
  STATE_CONFLICT: '当前状态不允许此操作，请刷新后重试。',
  SYNC_RESET_REQUIRED: '本地数据需要重新同步，请重新加载。',
  REVEAL_AUDIT_REQUIRED: '查看敏感原文需要明确确认。',
  SPLIT_NOT_CONSERVED: '拆分数量必须与来源内容一致。',
  NETWORK: '连接中断或响应未返回。输入已保留，请重试同一次操作。',
};
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const embedded = embeddedRuntime();
  if (embedded) return embedded.transport.request<T>(url);
  const tool = url.match(/^\/api\/(?:read|write)\/([^?]+)/)?.[1] ?? 'http_read';
  let input: unknown;
  try {
    input = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  } catch {
    /* fetch reports invalid input */
  }
  const timing = beginCall('HTTP', tool, input);
  timing.sample.write = init?.method === 'POST';
  try {
    const result = await requestImpl<T>(url, init, timing.sample);
    timing.finish('SUCCESS');
    return result;
  } catch (error) {
    timing.finish(error instanceof ApiError ? error.code : 'NETWORK');
    throw error;
  }
}
async function requestImpl<T>(
  url: string,
  init: RequestInit | undefined,
  timing: CallTiming,
): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    headers.set(PROTOCOL_HEADER, PROTOCOL_VERSION);
    const household =
      sessionStorage.getItem('acornary-household') ??
      localStorage.getItem('acornary-last-household');
    if (household && !headers.has('X-Acornary-Household'))
      headers.set('X-Acornary-Household', household);
    response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers,
    });
  } catch {
    throw new ApiError('NETWORK', messages.NETWORK);
  }
  timing.request_id = response.headers.get('X-Request-ID') ?? undefined;
  const duration = response.headers.get('Server-Timing')?.match(/total;dur=([\d.]+)/)?.[1];
  if (duration) timing.server_duration_ms = Number(duration);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError('NETWORK', messages.NETWORK, response.status);
  }
  if (!response.ok) {
    const code = data.error?.code ?? (response.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR');
    if (response.status === 403) window.dispatchEvent(new Event('acornary-refresh-session'));
    if (response.status === 401) window.dispatchEvent(new Event('acornary-session-expired'));
    throw new ApiError(
      code,
      messages[code] ?? '暂时无法完成，请稍后重试。',
      response.status,
      data.error?.details,
      data.error?.request_id,
      data.error?.recovery,
    );
  }
  return data;
}
export const read = <T>(name: Operation | 'get_note', input: unknown, signal?: AbortSignal) => {
  const embedded = embeddedRuntime();
  if (embedded) return embedded.transport.read<T>(name, input, signal);
  return request<T>(`/api/read/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
};
export const snapshot = (household?: string, signal?: AbortSignal) =>
  embeddedRuntime()?.transport.snapshot(signal) ??
  request<SnapshotV2>('/api/ui/snapshot', {
    headers: household ? { 'X-Acornary-Household': household } : {},
    signal,
  });
export const write = (
  name: Operation,
  payload: unknown,
  household?: string,
  userId?: string,
  scope?: string,
) =>
  embeddedRuntime()?.transport.write(name, payload, household, userId, scope) ??
  request<WriteResult>(`/api/write/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Acornary-Request': 'web',
      ...(household ? { 'X-Acornary-Household': household } : {}),
      ...(userId ? { 'X-Acornary-Account': userId } : {}),
    },
    body: JSON.stringify(payload),
  });
export const history = (
  id: string,
  kind: 'ITEM' | 'CATALOG_NODE',
  cursor?: string,
  signal?: AbortSignal,
) =>
  read<{ data: HistoryEvent[]; next_cursor?: string }>(
    'get_history',
    {
      target: { kind, id },
      limit: 30,
      ...(cursor ? { cursor } : {}),
    },
    signal,
  );

export const governance = <T>(action: 'review' | 'confirm', input: unknown) =>
  embeddedRuntime()?.transport.governance<T>(action, input) ??
  request<T>(`/api/ui/catalog-${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Acornary-Request': 'web' },
    body: JSON.stringify(input),
  });
