import QRCode from 'qrcode';
import { LABEL_PROFILES, type LabelProfile } from './label-profiles.js';

export const LABEL_WIDTH = 240;
export const LABEL_HEIGHT = 96;
export function labelQR(url: string, profile: LabelProfile = LABEL_PROFILES['30x12']) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const scale = profile.qrScale,
    quiet = 4;
  const size = (qr.modules.size + quiet * 2) * scale;
  if (size > profile.qrMax)
    throw new Error(`物品链接过长，无法在 ${profile.name} 标签上清晰打印二维码。`);
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
export function renderLabel(
  name: string,
  title: string,
  date: string | undefined,
  url: string,
  profile: LabelProfile = LABEL_PROFILES['30x12'],
) {
  const canvas = document.createElement('canvas');
  canvas.width = profile.width;
  canvas.height = profile.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法生成标签预览。');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, profile.width, profile.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  ctx.font = `600 ${profile.nameFont}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  labelNameLines(name, (s) => ctx.measureText(s).width, profile.textWidth).forEach((line, i) =>
    ctx.fillText(line, profile.margin, profile.nameTop + i * profile.nameLine),
  );
  ctx.font = `${profile.dateTitleFont}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.fillText(date ? title : '日期未记录', profile.margin, profile.dateTitleTop);
  if (date) {
    ctx.font = `${profile.dateFont}px sans-serif`;
    ctx.fillText(date, profile.margin, profile.dateTop);
  }
  const { qr, scale, quiet, size } = labelQR(url, profile);
  const x = profile.width - size - profile.margin,
    y = Math.floor((profile.height - size) / 2);
  for (let row = 0; row < qr.modules.size; row++)
    for (let col = 0; col < qr.modules.size; col++)
      if (qr.modules.get(row, col))
        ctx.fillRect(x + (col + quiet) * scale, y + (row + quiet) * scale, scale, scale);
  // The protocol encoder requires exact black/white; use this same bitmap for preview and print.
  const pixels = ctx.getImageData(0, 0, profile.width, profile.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = pixels.data[i] < 180 ? 0 : 255;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
