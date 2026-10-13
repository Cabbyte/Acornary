import { isLabelSize, type LabelSize } from './label-profiles.js';
import type { LabelPrinter } from './labels.js';

export interface PrinterPreferences {
  size: LabelSize;
  density: number;
}
export interface SessionPrinter extends LabelPrinter<HTMLCanvasElement> {
  connect(): Promise<void>;
  close(): Promise<void>;
  density: number;
  deviceName?: string;
}
export function printerPreferences(value: unknown): PrinterPreferences {
  const v = value as Partial<PrinterPreferences> | null;
  return {
    size: isLabelSize(v?.size) ? v.size : '30x12',
    density: [1, 2, 3].includes(v?.density ?? 0) ? v!.density! : 2,
  };
}
export type PrinterFactory = (disconnected: () => void) => SessionPrinter;

// Lives above the page and drawer, never holds item data or a persistent queue.
export class PrinterSession {
  private listeners = new Set<() => void>();
  private printer?: SessionPrinter;
  private disposed = false;
  private state;
  constructor(
    preferences: PrinterPreferences,
    private save: (p: PrinterPreferences) => void = () => {},
  ) {
    this.state = {
      ...preferences,
      connected: false,
      connecting: false,
      busy: false,
      name: '',
      error: '',
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(values: Partial<typeof this.state>) {
    this.state = { ...this.state, ...values };
    this.listeners.forEach((listener) => listener());
  }
  configure(values: Partial<PrinterPreferences>) {
    if (this.disposed || this.state.busy) return;
    const preferences = printerPreferences({ ...this.state, ...values });
    this.update(preferences);
    try {
      this.save(preferences);
    } catch {
      this.update({ error: '浏览器未能保存打印设置，本次页面内仍可使用。' });
    }
  }
  async connect(factory: PrinterFactory, replace = false) {
    if (
      this.disposed ||
      this.state.connecting ||
      this.state.busy ||
      (this.state.connected && !replace)
    )
      return;
    if (replace) {
      const old = this.printer;
      this.printer = undefined;
      void old?.close().catch(() => {});
    }
    if (!this.printer) {
      const next = factory(() => {
        if (!this.disposed && this.printer === next) this.update({ connected: false });
      });
      this.printer = next;
    }
    const next = this.printer;
    this.update({ connecting: true, connected: false, error: '' });
    try {
      // Synchronous call preserves user activation for the Bluetooth chooser.
      await next.connect();
      if (this.disposed) {
        await next.close();
        return;
      }
      this.update({ connected: true, name: next.deviceName || 'D101' });
    } catch (error) {
      await next.close().catch(() => {});
      if (!this.disposed)
        this.update({ connected: false, error: `连接未完成：${(error as Error).message}` });
    } finally {
      if (!this.disposed) this.update({ connecting: false });
    }
  }
  async disconnect() {
    if (this.state.busy || this.state.connecting) return;
    this.update({ connected: false, error: '' });
    await this.printer?.close().catch(() => {});
  }
  async run<T>(operation: (printer: SessionPrinter) => Promise<T>): Promise<T> {
    if (this.disposed || !this.state.connected || !this.printer)
      throw new Error('请先在设置中连接打印机。');
    if (this.state.busy) throw new Error('打印机正在处理上一批标签，请等待完成。');
    this.update({ busy: true });
    this.printer.density = this.state.density;
    try {
      return await operation(this.printer);
    } finally {
      if (!this.disposed) this.update({ busy: false });
    }
  }
  dispose() {
    this.disposed = true;
    this.update({ connected: false, connecting: false });
    void this.printer?.close().catch(() => {});
    this.listeners.clear();
  }
}
