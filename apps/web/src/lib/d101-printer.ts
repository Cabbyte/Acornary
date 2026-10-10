import {
  NiimbotBluetoothClient,
  ImageEncoder,
  PageColorType,
  PrinterModel,
} from '@mmote/niimbluelib';
import type { LabelPrinter } from './labels.js';

export class D101Printer implements LabelPrinter<HTMLCanvasElement> {
  private client = new NiimbotBluetoothClient();
  private closed = false;
  density = 2;
  constructor(disconnected: () => void) {
    this.client.on('disconnect', disconnected);
  }
  async connect() {
    await this.client.connect();
    if (this.closed) {
      await this.client.disconnect();
      throw new Error('打印窗口已关闭，请重新连接。');
    }
    if (this.client.getModelMetadata()?.model !== PrinterModel.D101) {
      await this.client.disconnect();
      throw new Error('第一版仅支持 D101，请选择正确的打印机。');
    }
  }
  async close() {
    this.closed = true;
    this.client.protocol.cancelStatusPoll();
    await this.client.disconnect();
  }
  async print(canvas: HTMLCanvasElement) {
    if (this.closed || !this.client.isConnected()) throw new Error('打印机已断开连接。');
    const type = this.client.getPrintTaskType();
    if (!type) throw new Error('无法识别 D101 打印协议。');
    const image = ImageEncoder.encodeCanvas(canvas, PageColorType.SingleColor, 'left');
    const task = this.client.protocol.newPrintTask(type, {
      totalPages: 1,
      density: this.density,
      pageColor: PageColorType.SingleColor,
      statusPollIntervalMs: 100,
      statusTimeoutMs: 15000,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await task.printInit();
          if (this.closed) throw new Error('打印已停止。');
          await task.printPage(image, 1);
          if (this.closed) throw new Error('打印已停止。');
          await task.waitForPageFinished();
          if (this.closed) throw new Error('打印已停止。');
          await task.waitForFinished();
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            void this.close().catch(() => {});
            reject(new Error('打印超过 45 秒，出纸结果待核对，请重新连接。'));
          }, 45000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.client.protocol.cancelStatusPoll();
      if (!this.closed && this.client.isConnected() && !(await task.printEnd()))
        throw new Error('打印机尚未确认结束，出纸结果待核对。');
    }
  }
}
