import type { Operation } from '../../../../packages/contracts/src/index';
import type {
  HistoryEvent,
  InventorySnapshot,
  WriteResult,
} from '../../../../packages/contracts/src/web';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const messages: Record<string, string> = {
  REVISION_CONFLICT: '记录已发生变化。请核对最新内容后重新提交。',
  IDEMPOTENCY_CONFLICT: '这次操作的重试信息不一致，请重新核对。',
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
  NETWORK: '连接中断或响应未返回。输入已保留，请重试同一次操作。',
};
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
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
    );
  }
  return data;
}
export const read = <T>(name: Operation, input: unknown) =>
  request<T>(`/api/read/${name}?input=${encodeURIComponent(JSON.stringify(input))}`);
export const snapshot = (household?: string) =>
  request<InventorySnapshot>('/api/ui/snapshot', {
    headers: household ? { 'X-Acornary-Household': household } : {},
  });
export const write = (name: Operation, payload: unknown, household?: string, userId?: string) =>
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
export const history = (id: string, kind: 'ITEM' | 'CATALOG_NODE', cursor?: string) =>
  read<{ data: HistoryEvent[]; next_cursor?: string }>('get_history', {
    target: { kind, id },
    limit: 30,
    ...(cursor ? { cursor } : {}),
  });
