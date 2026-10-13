import { expect, it, vi } from 'vitest';
import {
  PrinterSession,
  printerPreferences,
  type SessionPrinter,
} from '../apps/web/src/lib/printer-session.js';
function fixture() {
  const device = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    print: vi.fn().mockResolvedValue(undefined),
    density: 2,
    deviceName: 'D101-Test',
  };
  let disconnect!: () => void;
  const factory = vi.fn((callback: () => void) => {
    disconnect = callback;
    return device;
  });
  const save = vi.fn();
  const session = new PrinterSession(printerPreferences(null), save);
  return { session, factory, device, save, disconnect: () => disconnect() };
}
it('shares a paired printer across separate previews and reconnects the same device', async () => {
  const f = fixture();
  await f.session.connect(f.factory);
  const firstPreview = vi.fn(async (device: SessionPrinter) =>
    device.print({} as HTMLCanvasElement),
  );
  await f.session.run(firstPreview);
  await f.session.run(firstPreview);
  expect(f.factory).toHaveBeenCalledTimes(1);
  expect(f.device.connect).toHaveBeenCalledTimes(1);
  expect(f.device.close).not.toHaveBeenCalled();
  f.disconnect();
  expect(f.session.getSnapshot().connected).toBe(false);
  await f.session.connect(f.factory);
  expect(f.factory).toHaveBeenCalledTimes(1);
  expect(f.device.connect).toHaveBeenCalledTimes(2);
});
it('locks the physical printer and paper configuration while a previous page is in flight', async () => {
  const f = fixture();
  await f.session.connect(f.factory);
  let finish!: () => void;
  const running = f.session.run(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  await expect(f.session.run(async () => {})).rejects.toThrow('上一批');
  f.session.configure({ size: '40x20' });
  await f.session.disconnect();
  expect(f.session.getSnapshot().size).toBe('30x12');
  expect(f.device.close).not.toHaveBeenCalled();
  finish();
  await running;
  f.session.configure({ size: '40x20', density: 3 });
  expect(f.save).toHaveBeenCalledWith({ size: '40x20', density: 3 });
  await f.session.run(async (device) => {
    expect(device.density).toBe(3);
  });
});
it('closes the connection on account/scope disposal and ignores a late connection result', async () => {
  const f = fixture();
  let finish!: () => void;
  f.device.connect.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  const pending = f.session.connect(f.factory);
  f.session.dispose();
  finish();
  await pending;
  expect(f.session.getSnapshot().connected).toBe(false);
  expect(f.device.close).toHaveBeenCalled();
  await expect(f.session.run(async () => {})).rejects.toThrow('设置中连接');
});
it('cancelled pairing leaves preview data untouched and never sends a print', async () => {
  const f = fixture();
  f.device.connect.mockRejectedValue(new Error('User cancelled'));
  await f.session.connect(f.factory);
  expect(f.session.getSnapshot()).toMatchObject({ connecting: false, connected: false });
  expect(f.session.getSnapshot().error).toContain('User cancelled');
  expect(f.device.print).not.toHaveBeenCalled();
});
it('rejects corrupt saved preferences and tolerates denied storage', () => {
  expect(printerPreferences({ size: '__proto__', density: 99 })).toEqual({
    size: '30x12',
    density: 2,
  });
  const session = new PrinterSession(printerPreferences(null), () => {
    throw new Error('denied');
  });
  session.configure({ size: '40x20' });
  expect(session.getSnapshot().size).toBe('40x20');
  expect(session.getSnapshot().error).toContain('未能保存');
});
