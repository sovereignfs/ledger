/**
 * Regenerates `src/money/currencies.ts` from the Node runtime's own ICU database: `pnpm generate:currencies`, then commit the result.
 *
 * Generated-then-committed, not read from ICU at runtime, for three reasons: the table is then deterministic rather than varying with whichever ICU the
 * server and the browser each happen to carry; it is reviewable in a diff; and the client bundle gets a plain array instead of depending on
 * `Intl.supportedValuesOf`.
 *
 * ICU is the source for codes, display names and, most importantly, each currency's own fraction digits, which are not uniformly 2: ISO 4217 gives JPY, KRW,
 * CLP and ISK zero, and BHD, KWD and TND three. Getting those from ICU rather than by hand is the point of generating this.
 *
 * **Fiat only** (DESIGN.md §9.1): no crypto in phase 1, so nothing is appended. The two codes ICU lists that are not a currency anyone holds are left out: the
 * IMF's Special Drawing Right and the Sucre, a unit of account between ALBA's members.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface CurrencyOption {
  code: string;
  name: string;
  decimals: number;
}

const OUT = join(import.meta.dirname, '..', 'src', 'money', 'currencies.ts');

/** In ICU's list and not a currency a person holds. */
const NOT_HELD = new Set(['XDR', 'XSU']);

function build(): CurrencyOption[] {
  const displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });
  return Intl.supportedValuesOf('currency')
    .filter((code) => !NOT_HELD.has(code))
    .map((code) => ({
      code,
      // `of()` falls back to the code itself for anything ICU lacks a name for.
      name: displayNames.of(code) ?? code,
      // `maximumFractionDigits` is optional on the resolved options type, but is always present for `style: 'currency'`.
      decimals:
        new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
          .maximumFractionDigits ?? 2,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function render(options: CurrencyOption[]): string {
  const rows = options
    .map(
      (o) => `  { code: '${o.code}', name: ${JSON.stringify(o.name)}, decimals: ${o.decimals} },`,
    )
    .join('\n');

  return `// GENERATED FILE — do not edit by hand.
// Regenerate with \`pnpm generate:currencies\`; the generator's own doc comment explains the sources.

/**
 * The single pivot every \`fx_rate\` row is stored against (DESIGN.md §9.2): USD, since Frankfurter quotes every currency against it. A rate between any two
 * currencies is derived from their two legs at the date (\`src/fx\`, task 3.3).
 */
export const FX_PIVOT_CODE = 'USD';

export interface CurrencyOption {
  code: string;
  name: string;
  /**
   * Fraction digits this currency uses: the exponent relating a stored amount in minor units to the amount a person reads. **Not uniformly 2**: ISO 4217
   * gives JPY, KRW, CLP and ISK zero and BHD, KWD and TND three. Every amount is stored as an integer count of this currency's smallest unit, so this is
   * what both \`formatMoney\` and \`CurrencyInput\`'s \`decimals\` prop need.
   */
  decimals: number;
}

/**
 * Every currency selectable anywhere in Ledger: ICU's ISO 4217 set, with no crypto (DESIGN.md §9.1). A book uses the ones its accounts and categories name
 * (\`book_currency\`); the daily rate job fetches exactly those (task 3.3), not this whole list.
 */
export const CURRENCY_OPTIONS: readonly CurrencyOption[] = [
${rows}
];

const BY_CODE = new Map(CURRENCY_OPTIONS.map((c) => [c.code, c]));

/** True for a code the app supports: the only currencies any row may carry. */
export function isSupportedCurrencyCode(code: string): boolean {
  return BY_CODE.has(code);
}

/** The currency with this code, or undefined. */
export function currencyOption(code: string): CurrencyOption | undefined {
  return BY_CODE.get(code);
}

/**
 * This currency's fraction digits, defaulting to 2 for an unknown code. The default matters: a row restored from an export of another instance must still
 * render as *something* sane rather than throwing mid-render.
 */
export function currencyDecimals(code: string): number {
  return BY_CODE.get(code)?.decimals ?? 2;
}

/** The whole-unit scale for a currency: 10 ** its fraction digits, which is how many minor units make one major unit. */
export function currencyScale(code: string): number {
  return 10 ** currencyDecimals(code);
}
`;
}

const options = build();
writeFileSync(OUT, render(options), 'utf8');
console.log(`[generate-currencies] wrote ${options.length} currencies to ${OUT}`);
