import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssVariables } from '../apps/web/src/ui/tokens.js';

const firstRoot = (css: string) => {
  const match = /:root\s*\{([\s\S]*?)\}/.exec(css);
  return match?.[1] ?? '';
};
const parse = (css: string) => {
  const values = new Map<string, string>();
  for (const match of firstRoot(css).matchAll(/(--ac-[a-z0-9-]+):\s*([^;]+);/g))
    values.set(match[1], match[2].trim());
  return values;
};

describe('design tokens', () => {
  it('keeps tokens.css in sync with tokens.ts', () => {
    const generated = parse(cssVariables);
    const file = parse(readFileSync('apps/web/src/ui/tokens.css', 'utf8'));
    expect(generated.size).toBeGreaterThan(20);
    for (const [name, value] of generated) {
      expect(file.get(name), name).toBe(value);
    }
  });
});
