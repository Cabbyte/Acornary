import { SelectionSync } from './selection.js';
import { App } from '@modelcontextprotocol/ext-apps';
import {
  pluginEnvelopeSchema,
  pluginMetaKey,
  pluginViewTool,
  pluginWriteTool,
  type PluginEnvelope,
} from '../../../../packages/contracts/src/plugin.js';
import {
  inventoryFilterSchema,
  productGroups,
  type WriteResult,
} from '../../../../packages/contracts/src/web.js';
import { ApiError, messages } from '../lib/api.js';
import type { InventoryTransport, Selection } from '../lib/runtime.js';
import type { Operation } from '../../../../packages/contracts/src/index.js';
import { domainErrorStatus } from '../../../../packages/contracts/src/errors.js';

export class PluginClient implements InventoryTransport {
  readonly app = new App(
    { name: 'Acornary', version: '0.1.0' },
    { availableDisplayModes: ['fullscreen'] },
    { autoResize: true },
  );
  envelope?: PluginEnvelope;
  private seed?: PluginEnvelope;
  private boot?: (value: PluginEnvelope) => void;
  private ready = false;
  private generation = 0;
  private selectionSync = new SelectionSync((selection) =>
    this.app.updateModelContext(
      {
        content: [
          {
            type: 'text',
            text: selection
              ? `当前选中的松仓对象（仅为上下文，不授权修改）：${JSON.stringify(selection)}`
              : '当前没有选中的松仓对象。',
          },
        ],
        structuredContent: { selection },
      },
      { timeout: 5000 },
    ),
  );
  onChange: (envelope: PluginEnvelope) => void = () => {};
  onInvalidate: () => void = () => {};
  onExpired: () => void = () => {};
  constructor() {
    this.app.addEventListener('toolresult', (result) => {
      if (!this.ready) {
        const parsed = pluginEnvelopeSchema.safeParse(result._meta?.[pluginMetaKey]);
        if (parsed.success) {
          this.accept(parsed.data);
          this.boot?.(parsed.data);
        }
      } else if (!result._meta?.[pluginMetaKey]) this.onInvalidate(); // Notifications are hints; never apply possibly stale snapshots.
    });
    this.app.addEventListener('hostcontextchanged', (context) => {
      if (context.theme) document.documentElement.dataset.hostTheme = context.theme;
    });
  }
  private accept(envelope: PluginEnvelope) {
    const changed = this.envelope?.session.cache_key !== envelope.session.cache_key;
    this.envelope = envelope;
    if (changed) {
      this.generation++;
      this.seed = envelope;
      this.select(null);
    }
    this.onChange(envelope);
  }
  async connect() {
    const initial = new Promise<PluginEnvelope>((resolve) => {
      this.boot = resolve;
    });
    await this.app.connect();
    this.selectionSync.activate();
    window.addEventListener('pagehide', () => this.selectionSync.dispose(), { once: true });
    const context = this.app.getHostContext();
    if (context?.theme) document.documentElement.dataset.hostTheme = context.theme;
    if (context?.displayMode === 'inline' && context.availableDisplayModes?.includes('fullscreen'))
      await this.app.requestDisplayMode({ mode: 'fullscreen' }).catch(() => {});
    // Initial opener result is the first render. Fetch only if it was not delivered.
    const first = await Promise.race([
      initial,
      new Promise<undefined>((resolve) => setTimeout(resolve, 500)),
    ]);
    // Once fallback starts, late opener notifications cannot change its
    // generation. The in-flight authoritative read owns initialization.
    this.ready = true;
    if (!first) this.accept(await this.fetchEnvelope());
    this.seed = this.envelope;
    return this.envelope!;
  }
  private async call(name: string, input: unknown, signal?: AbortSignal) {
    const generation = this.generation;
    const ensureCurrent = () => {
      if (signal?.aborted || generation !== this.generation)
        throw new DOMException('Request belongs to an inactive session.', 'AbortError');
    };
    try {
      ensureCurrent();
      const result = await this.app.callServerTool(
        { name, arguments: input as Record<string, unknown> },
        { signal, timeout: 15000 },
      );
      ensureCurrent();
      if (result.isError) {
        const error = (
          result.structuredContent as
            { error?: { code?: string; message?: string; details?: unknown } } | undefined
        )?.error;
        const code = error?.code ?? 'INTERNAL_ERROR';
        throw new ApiError(
          code,
          messages[code] ?? error?.message ?? '暂时无法完成，请重试。',
          domainErrorStatus(code) ?? 0,
          error?.details,
        );
      }
      return result;
    } catch (error) {
      ensureCurrent();
      const failure =
        error instanceof ApiError
          ? error
          : /\b(401|403)\b|unauthorized|forbidden|insufficient.scope/i.test(String(error))
            ? new ApiError('UNAUTHORIZED', messages.UNAUTHORIZED, 401)
            : new ApiError('NETWORK', messages.NETWORK);
      if (failure.status === 401 || failure.status === 403) {
        this.select(null);
        this.onExpired();
      }
      if (failure.code === 'SESSION_CHANGED') {
        this.select(null);
        this.onInvalidate();
      }
      throw failure;
    }
  }
  private async fetchEnvelope(signal?: AbortSignal) {
    const result = await this.call(pluginViewTool, {}, signal);
    const parsed = pluginEnvelopeSchema.safeParse(result._meta?.[pluginMetaKey]);
    if (!parsed.success) throw new ApiError('NETWORK', '库存响应格式不正确，请重新打开插件。');
    return parsed.data;
  }
  async snapshot(signal?: AbortSignal) {
    if (this.seed) {
      const seed = this.seed;
      this.seed = undefined;
      return seed.snapshot;
    }
    const previous = this.envelope?.session.cache_key;
    const envelope = await this.fetchEnvelope(signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    this.accept(envelope);
    if (previous !== envelope.session.cache_key)
      throw new ApiError('UNAUTHORIZED', '连接账号或家庭已改变，正在重新加载。', 401);
    return envelope.snapshot;
  }
  async read<T>(name: Operation, input: unknown, signal?: AbortSignal): Promise<T> {
    return (await this.call(name, input, signal)).structuredContent as T;
  }
  async write(
    name: Operation,
    payload: unknown,
    household?: string,
    userId?: string,
    scope?: string,
  ): Promise<WriteResult> {
    if (
      scope !== this.envelope?.session.cache_key ||
      household !== this.envelope?.session.household_id ||
      userId !== this.envelope?.session.user_id
    )
      throw new ApiError('UNAUTHORIZED', '连接账号或家庭已改变，请重新打开操作。', 401);
    if (!this.envelope?.session.can_write)
      throw new ApiError('FORBIDDEN', '当前连接只有读取权限。', 403);
    return (
      await this.call(pluginWriteTool, { expected_scope: scope, operation: name, input: payload })
    ).structuredContent as unknown as WriteResult;
  }
  async request<T>(url: string): Promise<T> {
    if (url.startsWith('/api/ui/groups?') && this.envelope) {
      const filter = inventoryFilterSchema.parse(
        Object.fromEntries(new URLSearchParams(url.split('?')[1])),
      );
      return productGroups(this.envelope.snapshot, filter) as T;
    }
    throw new ApiError('FORBIDDEN', '此功能请在松仓网站中使用。', 403);
  }
  select(selection: Selection | null) {
    this.selectionSync.select(selection);
  }
}
