import type { ThemeConfig } from 'antd';
import source from './tokens/source.json' with { type: 'json' };

/**
 * The single source of truth for Acornary's visual language.
 *
 * `tokens.ts` feeds both the generated CSS variables (`cssVariables`, mirrored in
 * `tokens.css`) and Ant Design's ThemeConfig (`antThemeFromTokens`). Ant needs real
 * color values, not `var()`, so both consumers read from this object.
 */
export const tokens = source.legacy.tokens;

const colorVariableNames = {
  paper: 'paper',
  surface: 'surface',
  surfaceRaised: 'surface-raised',
  ink: 'ink',
  ink2: 'ink-2',
  muted: 'muted',
  line: 'line',
  lineStrong: 'line-strong',
  accent: 'accent',
  accentHover: 'accent-hover',
  accentSoft: 'accent-soft',
  success: 'success',
  successSoft: 'success-soft',
  warning: 'warning',
  warningSoft: 'warning-soft',
  danger: 'danger',
  dangerSoft: 'danger-soft',
  info: 'info',
  infoSoft: 'info-soft',
  catFood: 'cat-food',
  catFoodInk: 'cat-food-ink',
  catClothing: 'cat-clothing',
  catClothingInk: 'cat-clothing-ink',
  catDevice: 'cat-device',
  catDeviceInk: 'cat-device-ink',
  catCleaning: 'cat-cleaning',
  catCleaningInk: 'cat-cleaning-ink',
  catNeutral: 'cat-neutral',
  catNeutralInk: 'cat-neutral-ink',
} as const satisfies Record<keyof typeof tokens.colors, string>;

const colorLines = (Object.keys(tokens.colors) as Array<keyof typeof tokens.colors>).map(
  (name) => `  --ac-${colorVariableNames[name]}: ${tokens.colors[name]};`,
);

const fontLines = [
  `  --ac-font-sans: ${tokens.fonts.sans};`,
  `  --ac-font-display: ${tokens.fonts.display};`,
];

const spacingLines = Object.entries(tokens.spacing).map(
  ([step, value]) => `  --ac-space-${step}: ${value}px;`,
);

const controlLines = Object.entries(tokens.controls).map(
  ([size, value]) => `  --ac-control-${size}: ${value}px;`,
);

const rowLines = Object.entries(tokens.rows).map(
  ([size, value]) => `  --ac-row-${size}: ${value}px;`,
);

const radiusLines = Object.entries(tokens.radii).map(
  ([name, value]) => `  --ac-radius-${name}: ${value}px;`,
);

const typeLines = Object.entries(tokens.type).flatMap(([role, value]) => [
  `  --ac-text-${role}-size: ${value.fontSize}px;`,
  `  --ac-text-${role}-line-height: ${value.lineHeight};`,
  `  --ac-text-${role}-weight: ${value.fontWeight};`,
]);

const motionLines = [
  `  --ac-motion-fast: ${tokens.motion.fast};`,
  `  --ac-motion-base: ${tokens.motion.base};`,
  `  --ac-motion-easing: ${tokens.motion.easing};`,
];

const widthLines = Object.entries(tokens.widths).map(
  ([name, value]) => `  --ac-width-${name}: ${value}px;`,
);

const sheetLines = Object.entries(tokens.sheets).map(
  ([name, value]) => `  --ac-sheet-${name}: ${value}px;`,
);

/**
 * The `:root` block mirrored in `tokens.css`. Keeping both consumers on this
 * string means a token change cannot land in TypeScript without landing in CSS.
 */
export const cssVariables = [
  ':root {',
  ...colorLines,
  '',
  ...fontLines,
  '',
  ...spacingLines,
  '',
  ...controlLines,
  '',
  ...rowLines,
  '',
  ...radiusLines,
  '',
  ...typeLines,
  '',
  ...motionLines,
  '',
  ...widthLines,
  '',
  ...sheetLines,
  '}',
  '',
].join('\n');

/**
 * Maps the design tokens onto Ant Design's ThemeConfig. Ant consumes concrete
 * values, so this reads the token values directly instead of CSS variables.
 */
export function antThemeFromTokens(): ThemeConfig {
  return {
    token: {
      colorPrimary: tokens.colors.accent,
      colorPrimaryHover: tokens.colors.accentHover,
      colorLink: tokens.colors.ink2,
      colorLinkHover: tokens.colors.ink,
      colorBgLayout: tokens.colors.paper,
      colorBgContainer: tokens.colors.surface,
      colorBgElevated: tokens.colors.surfaceRaised,
      colorText: tokens.colors.ink,
      colorTextSecondary: tokens.colors.muted,
      colorTextDescription: tokens.colors.muted,
      colorBorder: tokens.colors.lineStrong,
      colorBorderSecondary: tokens.colors.line,
      colorSuccess: tokens.colors.success,
      colorWarning: tokens.colors.warning,
      colorError: tokens.colors.danger,
      colorInfo: tokens.colors.info,
      borderRadius: tokens.radii.control,
      borderRadiusLG: tokens.radii.panel,
      fontSize: tokens.type.body.fontSize,
      controlHeight: tokens.controls.md,
      fontFamily: tokens.fonts.sans,
    },
  };
}
