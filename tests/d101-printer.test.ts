import { beforeEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  model: 'D101',
  connected: false,
  connect: vi.fn(),
  disconnect: vi.fn(),
  printInit: vi.fn(),
  printPage: vi.fn(),
  waitForPageFinished: vi.fn(),
  waitForFinished: vi.fn(),
  printEnd: vi.fn(),
  newPrintTask: vi.fn(),
  encodeCanvas: vi.fn(),
}));
vi.mock('@mmote/niimbluelib', () => ({
  PrinterModel: { D101: 'D101' },
  PageColorType: { SingleColor: 1 },
  ImageEncoder: { encodeCanvas: fake.encodeCanvas },
  NiimbotBluetoothClient: class {
    on() {}
    connect = fake.connect;
    disconnect = fake.disconnect;
    isConnected() {
      return fake.connected;
    }
    getModelMetadata() {
      return { model: fake.model };
    }
    getPrintTaskType() {
      return 'B1';
    }
    protocol = { newPrintTask: fake.newPrintTask, cancelStatusPoll: vi.fn() };
  },
}));
import { D101Printer } from '../apps/web/src/lib/d101-printer.js';
beforeEach(() => {
  vi.resetAllMocks();
  fake.model = 'D101';
  fake.connected = false;
  fake.connect.mockImplementation(async () => {
    fake.connected = true;
  });
  fake.disconnect.mockImplementation(async () => {
    fake.connected = false;
  });
  fake.newPrintTask.mockReturnValue(fake);
  fake.printEnd.mockResolvedValue(true);
  fake.encodeCanvas.mockReturnValue('encoded');
});
it('uses negotiated D101 task, one sheet, left rotation and waits for completion', async () => {
  const printer = new D101Printer(vi.fn());
  await printer.connect();
  const canvas = {} as HTMLCanvasElement;
  await printer.print(canvas);
  expect(fake.encodeCanvas).toHaveBeenCalledWith(canvas, 1, 'left');
  expect(fake.newPrintTask).toHaveBeenCalledWith(
    'B1',
    expect.objectContaining({ totalPages: 1, density: 2 }),
  );
  expect(fake.printPage).toHaveBeenCalledExactlyOnceWith('encoded', 1);
  expect(fake.waitForFinished).toHaveBeenCalledTimes(1);
  expect(fake.printEnd).toHaveBeenCalledTimes(1);
});
it('does not retry on lost completion and always attempts cleanup', async () => {
  fake.waitForFinished.mockRejectedValue(new Error('timeout'));
  const printer = new D101Printer(vi.fn());
  await printer.connect();
  await expect(printer.print({} as HTMLCanvasElement)).rejects.toThrow('timeout');
  expect(fake.printPage).toHaveBeenCalledTimes(1);
  expect(fake.printEnd).toHaveBeenCalledTimes(1);
});
it('rejects another model without printing', async () => {
  fake.model = 'B1';
  const printer = new D101Printer(vi.fn());
  await expect(printer.connect()).rejects.toThrow('仅支持 D101');
  expect(fake.disconnect).toHaveBeenCalledTimes(1);
  expect(fake.printPage).not.toHaveBeenCalled();
});
it('disconnects a permission request that resolves after its window was closed', async () => {
  let resolve!: () => void;
  fake.connect.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const printer = new D101Printer(vi.fn());
  const pending = printer.connect();
  await printer.close();
  resolve();
  await expect(pending).rejects.toThrow('窗口已关闭');
  expect(fake.disconnect).toHaveBeenCalledTimes(2);
  await expect(printer.print({} as HTMLCanvasElement)).rejects.toThrow('断开');
});

it('bounds a printer that keeps responding without ever finishing', async () => {
  vi.useFakeTimers();
  try {
    fake.waitForFinished.mockImplementation(() => new Promise(() => {}));
    const printer = new D101Printer(vi.fn());
    await printer.connect();
    const result = expect(printer.print({} as HTMLCanvasElement)).rejects.toThrow('45 秒');
    await vi.advanceTimersByTimeAsync(45000);
    await result;
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.printPage).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it('treats an unconfirmed print-end response as uncertain', async () => {
  fake.printEnd.mockResolvedValue(false);
  const printer = new D101Printer(vi.fn());
  await printer.connect();
  await expect(printer.print({} as HTMLCanvasElement)).rejects.toThrow('尚未确认结束');
});
