import type { RecordStore } from '../lib/runtime.js';

export interface WidgetBridge {
  widgetState?: unknown;
  setWidgetState?: (state: unknown) => void | Promise<void>;
}
interface PrivateState {
  version: 1;
  scope: string;
  records: Record<string, unknown>;
  route?: string;
}
export class WidgetStore implements RecordStore {
  private state: PrivateState;
  private memory = new Map<string, unknown>();
  private pending: Promise<void> = Promise.resolve();
  constructor(
    private bridge: () => WidgetBridge | undefined,
    readonly scope: string,
  ) {
    const widget = bridge()?.widgetState as
      { privateContent?: { acornary?: PrivateState } } | undefined;
    const saved = widget?.privateContent?.acornary;
    if (
      saved &&
      (typeof saved.scope !== 'string' ||
        (saved.scope === scope &&
          (saved.version !== 1 ||
            !saved.records ||
            typeof saved.records !== 'object' ||
            Array.isArray(saved.records))))
    )
      throw new Error('当前组件的草稿状态无法安全恢复，请先核对原操作结果。');
    this.state =
      saved?.version === 1 &&
      saved.scope === scope &&
      saved.records &&
      typeof saved.records === 'object' &&
      !Array.isArray(saved.records)
        ? structuredClone(saved)
        : { version: 1, scope, records: {} };
  }
  get route() {
    return typeof this.state.route === 'string' &&
      /^\/(items|places|catalog|search|settings)([/?]|$)/.test(this.state.route)
      ? this.state.route
      : '/items';
  }
  private check(key: string) {
    if (!key.startsWith(`${this.scope}:`)) throw new Error('草稿所属账号或家庭已改变。');
  }
  async get<T>(key: string): Promise<T | undefined> {
    this.check(key);
    return structuredClone(
      (key.includes(':draft:') ? this.state.records[key] : this.memory.get(key)) as T | undefined,
    );
  }
  async set(key: string, value: unknown): Promise<void> {
    this.check(key);
    if (!key.includes(':draft:')) {
      this.memory.set(key, structuredClone(value));
      return;
    }
    return this.save((state) => {
      if (value === undefined) delete state.records[key];
      else state.records[key] = structuredClone(value);
    });
  }
  rememberRoute(route: string) {
    return this.save((state) => {
      state.route = route;
    });
  }
  private save(change: (state: PrivateState) => void): Promise<void> {
    const task = this.pending
      .catch(() => {})
      .then(async () => {
        const bridge = this.bridge();
        if (!bridge?.setWidgetState)
          throw new Error(
            '宿主无法可靠保存草稿，本次修改尚未发送。请在支持组件状态保存的宿主中重试。',
          );
        const next = structuredClone(this.state);
        change(next);
        // Private state never becomes model context. Read-back is required before dispatch.
        const saved = { modelContent: null, privateContent: { acornary: next } };
        await bridge.setWidgetState(saved);
        const readback = (this.bridge()?.widgetState as typeof saved | undefined)?.privateContent
          ?.acornary;
        if (JSON.stringify(readback) !== JSON.stringify(next))
          throw new Error('宿主尚未确认草稿保存，本次修改尚未发送。');
        this.state = next;
      });
    this.pending = task;
    return task;
  }
}
