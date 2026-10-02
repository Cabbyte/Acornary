import type { Selection } from '../lib/runtime.js';

// Keep only the latest desired value. A failed clear must not be mistaken for
// an acknowledged clear, even after auth loss stops inventory polling.
export class SelectionSync {
  private desired: Selection | null = null;
  private confirmed: string | undefined;
  private active = false;
  private busy = false;
  private delay = 250;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private send: (selection: Selection | null) => Promise<unknown>) {}
  activate() {
    this.active = true;
    this.schedule(0);
  }
  select(selection: Selection | null) {
    this.desired = selection;
    this.schedule(0);
  }
  dispose() {
    this.active = false;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  private schedule(delay: number) {
    if (
      !this.active ||
      this.busy ||
      this.timer !== undefined ||
      JSON.stringify(this.desired) === this.confirmed
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
  }
  private async flush() {
    if (!this.active || this.busy) return;
    const value = this.desired;
    const serialized = JSON.stringify(value);
    if (serialized === this.confirmed) return;
    this.busy = true;
    let retry = 0;
    try {
      await this.send(value);
      this.confirmed = serialized;
      this.delay = 250;
    } catch {
      retry = this.delay;
      this.delay = Math.min(5000, this.delay * 2);
    } finally {
      this.busy = false;
      this.schedule(retry);
    }
  }
}
