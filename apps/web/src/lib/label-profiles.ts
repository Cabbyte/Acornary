// Each paper size has one layout for now. Keep geometry explicit so adding another
// layout does not change the dots or quiet zone of an already calibrated label.
export const LABEL_PROFILES = {
  '30x12': {
    id: '30x12',
    name: '30 × 12 mm',
    width: 240,
    height: 96,
    layout: '名称、日期与二维码',
    margin: 5,
    textWidth: 140,
    nameFont: 16,
    nameTop: 8,
    nameLine: 19,
    dateTitleFont: 13,
    dateTitleTop: 53,
    dateFont: 16,
    dateTop: 73,
    qrScale: 2,
    qrMax: 84,
  },
  '40x20': {
    id: '40x20',
    name: '40 × 20 mm',
    width: 320,
    height: 160,
    layout: '名称、日期与二维码',
    margin: 8,
    textWidth: 170,
    nameFont: 20,
    nameTop: 12,
    nameLine: 26,
    dateTitleFont: 16,
    dateTitleTop: 100,
    dateFont: 20,
    dateTop: 127,
    qrScale: 3,
    qrMax: 126,
  },
} as const;
export type LabelSize = keyof typeof LABEL_PROFILES;
export type LabelProfile = (typeof LABEL_PROFILES)[LabelSize];
export function isLabelSize(value: unknown): value is LabelSize {
  return typeof value === 'string' && Object.hasOwn(LABEL_PROFILES, value);
}
