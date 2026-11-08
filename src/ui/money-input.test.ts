import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A money field is `MoneyInput`, which gives `CurrencyInput` the currency's own decimals (DESIGN.md §9.1). `CurrencyInput` itself defaults to two, so a field
 * that used it directly would record yen a hundred times too small and dinars ten times too large. Only `MoneyInput` may name it.
 */
const ROOT = path.resolve(__dirname, '..', '..');

function walk(folder: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, folder))) {
    const relative = path.join(folder, name);
    if (statSync(path.join(ROOT, relative)).isDirectory()) out.push(...walk(relative));
    else if (/\.(ts|tsx)$/.test(name)) out.push(relative);
  }
  return out;
}

/** Whether a source file uses the design system's `CurrencyInput`: imports it, or draws it. A comment that names it does not. */
export const usesCurrencyInput = (source: string): boolean =>
  /<CurrencyInput\b/.test(source) || /import[^;]*\bCurrencyInput\b[^;]*from/.test(source);

describe('money fields', () => {
  const files = [...walk('src'), ...walk('app')].filter((file) => !/\.test\.tsx?$/.test(file));

  it('are written with MoneyInput, and only MoneyInput names CurrencyInput', () => {
    const offenders = files
      .filter((file) => file !== path.join('src', 'ui', 'MoneyInput.tsx'))
      .filter((file) => usesCurrencyInput(readFileSync(path.join(ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('are bound to a currency by the one component that does it', () => {
    const source = readFileSync(path.join(ROOT, 'src', 'ui', 'MoneyInput.tsx'), 'utf8');
    expect(source).toContain('decimals={currencyDecimals(currency)}');
  });

  it('is held by a check that can fail: a file that imports or draws CurrencyInput is found, and a comment is not', () => {
    expect(usesCurrencyInput("import { CurrencyInput } from '@sovereignfs/ui';")).toBe(true);
    expect(
      usesCurrencyInput("import { Input, CurrencyInput as Money } from '@sovereignfs/ui';"),
    ).toBe(true);
    expect(usesCurrencyInput('return <CurrencyInput valueCents={1} />;')).toBe(true);
    expect(usesCurrencyInput('// `CurrencyInput` defaults to two decimals\nconst x = 1;')).toBe(
      false,
    );
  });
});
