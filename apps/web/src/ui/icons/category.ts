import type { IconName } from './names.js';

export type CategoryTone = 'food' | 'clothing' | 'device' | 'cleaning' | 'neutral';

const TONE_BY_CATEGORY: Array<[RegExp, CategoryTone]> = [
  [/食品|饮|乳|主食|粮油/, 'food'],
  [/衣|服饰/, 'clothing'],
  [/设备|电子|电器|数码/, 'device'],
  [/日用|清洁|洗护/, 'cleaning'],
];

export function categoryTone(category: string): CategoryTone {
  return TONE_BY_CATEGORY.find(([pattern]) => pattern.test(category))?.[1] ?? 'neutral';
}

const FALLBACK_ICONS: Record<CategoryTone, IconName> = {
  food: 'apple',
  clothing: 'shirt',
  device: 'plug',
  cleaning: 'spray',
  neutral: 'package',
};

/** Keyword matching is intentionally item-level; category is only the fallback. */
export function categoryIcon(name: string, product: string, category: string): IconName {
  const text = `${name} ${product}`;
  if (/奶|牛奶|乳/.test(text)) return 'milk';
  if (/米|大米|粮|面|粥|饭/.test(text)) return 'soup';
  if (/咖啡|茶|饮料|果汁|汽水/.test(text)) return 'cup';
  if (/洗|清洁|洗衣|消毒|沐浴/.test(text)) return 'spray';
  if (/衣|T恤|裤|裙|袜|帽|鞋/.test(text)) return 'shirt';
  if (/USB|线|扩展坞|电脑|相机|耳机|充电|电池/.test(text)) return 'plug';
  if (/药|胶囊|片剂|维生素/.test(text)) return 'pill';
  if (/文件|证件|票据|合同|书/.test(text)) return 'file';
  if (/工具|螺丝|锤|钳|刀/.test(text)) return 'wrench';
  if (/猫|狗|宠物|粮/.test(text)) return 'paw';
  return FALLBACK_ICONS[categoryTone(category)];
}
