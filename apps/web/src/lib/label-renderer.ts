import QRCode from 'qrcode';

export const LABEL_WIDTH = 240;
export const LABEL_HEIGHT = 96;
export function labelQR(url: string) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const scale = 2,
    quiet = 4;
  const size = (qr.modules.size + quiet * 2) * scale;
  if (size > 84) throw new Error('物品链接过长，无法在 30 × 12 mm 标签上清晰打印二维码。');
  return { qr, scale, quiet, size };
}
export function labelNameLines(name: string, measure: (s: string) => number, width: number) {
  const chars = Array.from(name.replace(/\s+/g, ' ').trim());
  const lines: string[] = [];
  for (let row = 0; row < 2 && chars.length; row++) {
    let line = '';
    while (chars.length && measure(line + chars[0]) <= width) line += chars.shift();
    if (row === 1 && chars.length) {
      while (line && measure(line + '…') > width) line = Array.from(line).slice(0, -1).join('');
      line += '…';
    }
    lines.push(line);
  }
  return lines;
}
export function renderLabel(name: string, title: string, date: string | undefined, url: string) {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_WIDTH;
  canvas.height = LABEL_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法生成标签预览。');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  ctx.font = '600 16px "PingFang SC", "Microsoft YaHei", sans-serif';
  labelNameLines(name, (s) => ctx.measureText(s).width, 140).forEach((line, i) =>
    ctx.fillText(line, 5, 8 + i * 19),
  );
  ctx.font = '13px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(date ? title : '日期未记录', 5, 53);
  if (date) {
    ctx.font = '16px sans-serif';
    ctx.fillText(date, 5, 73);
  }
  const { qr, scale, quiet, size } = labelQR(url);
  const x = LABEL_WIDTH - size - 5,
    y = Math.floor((LABEL_HEIGHT - size) / 2);
  for (let row = 0; row < qr.modules.size; row++)
    for (let col = 0; col < qr.modules.size; col++)
      if (qr.modules.get(row, col))
        ctx.fillRect(x + (col + quiet) * scale, y + (row + quiet) * scale, scale, scale);
  // The protocol encoder requires exact black/white; use this same bitmap for preview and print.
  const pixels = ctx.getImageData(0, 0, LABEL_WIDTH, LABEL_HEIGHT);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = pixels.data[i] < 180 ? 0 : 255;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
