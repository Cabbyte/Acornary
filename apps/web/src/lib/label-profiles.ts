// Each paper size has one layout for now. Keep geometry explicit so adding another
// layout does not change the dots or quiet zone of an already calibrated label.
export const LABEL_PROFILES = {
  '30x12': {
    id: '30x12',
    name: '30 × 12 mm',
    width: 240,
    height: 96,
    layout: '名称、规格、日期与二维码',
    margin: 5,
    textWidth: 140,
    nameFont: 16,
    nameTop: 4,
    nameLine: 18,
    dateTitleFont: 11,
    dateTitleTop: 63,
    dateFont: 14,
    dateTop: 77,
    specFont: 12,
    specTop: 44,
    specLine: 14,
    specLines: 1,
    qrTop: 0,
    suffixTop: 86,
    suffixFont: 9,
    qrScale: 2,
    qrMax: 84,
  },
  '40x20': {
    id: '40x20',
    name: '40 × 20 mm',
    width: 320,
    height: 160,
    layout: '名称、规格、日期与二维码',
    margin: 8,
    textWidth: 170,
    nameFont: 20,
    nameTop: 8,
    nameLine: 25,
    dateTitleFont: 14,
    dateTitleTop: 114,
    dateFont: 18,
    dateTop: 135,
    specFont: 16,
    specTop: 64,
    specLine: 19,
    specLines: 2,
    qrTop: 8,
    suffixTop: 139,
    suffixFont: 12,
    qrScale: 3,
    qrMax: 126,
  },
} as const;
export type LabelSize = keyof typeof LABEL_PROFILES;
export type LabelProfile = (typeof LABEL_PROFILES)[LabelSize];
export function isLabelSize(value: unknown): value is LabelSize {
  return typeof value === 'string' && Object.hasOwn(LABEL_PROFILES, value);
}
