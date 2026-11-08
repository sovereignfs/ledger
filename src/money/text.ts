import { currencyDecimals } from './currencies';
import { assertMinor } from './amount';

/**
 * An amount as a person reads it, and as a person types it (DESIGN.md §9.1), in the currency's own number of decimals and a locale's own marks. **Both go
 * through decimal text and integers, never a float**: an amount is turned into the digits it is made of (`123456` of a currency with two decimals is
 * "1234.56") and `Intl` is given that text, which it formats exactly; and typed text is read digit by digit into minor units.
 */

/** The decimal text of an amount: `-3.40`, `1500`, `1.005`. Exact, for any amount. */
export function decimalText(minor: number, currency: string): string {
  assertMinor(minor);
  const decimals = currencyDecimals(currency);
  const digits = BigInt(Math.abs(minor))
    .toString()
    .padStart(decimals + 1, '0');
  const whole = decimals === 0 ? digits : digits.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : `.${digits.slice(-decimals)}`;
  return `${minor < 0 ? '-' : ''}${whole}${fraction}`;
}

/** An amount in its currency, in a locale: `¥1,500`, `BHD 1.005`, `-€3.40`. `locale` is a BCP 47 tag, or the runtime's default. */
export function formatMoney(minor: number, currency: string, locale?: string): string {
  const decimals = currencyDecimals(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(decimalText(minor, currency) as `${number}`);
}

/** The marks a locale writes numbers with: the decimal one, and the ones that group digits (a space, an apostrophe, a comma or a dot). */
function marks(locale: string | undefined): { decimal: string; group: string[] } {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';
  const group = parts.find((part) => part.type === 'group')?.value ?? ',';
  // Whatever looks like a space is one, and an apostrophe groups in some locales and is typed either way.
  return { decimal, group: [group, ' ', ' ', ' ', '’', "'"] };
}

/**
 * What a person typed as a number of minor units of `currency`, or null if it is not an amount: nothing, a letter, two decimal marks, more decimals than the
 * currency has (it is refused and not rounded, so that "1.005" in euros is not quietly 1.01), or a number too large to be exact. A leading minus is a
 * negative amount; grouping marks are ignored, and the decimal mark is the locale's.
 */
export function parseAmount(text: string, currency: string, locale?: string): number | null {
  const decimals = currencyDecimals(currency);
  const { decimal, group } = marks(locale);
  let value = text.trim();
  let negative = false;
  if (value.startsWith('-') || value.startsWith('−')) {
    negative = true;
    value = value.slice(1).trim();
  } else if (value.startsWith('+')) value = value.slice(1).trim();
  const pieces = value.split(decimal);
  if (pieces.length > 2) return null;
  let [whole = ''] = pieces;
  const [, fraction = ''] = pieces;
  // Grouping marks are allowed only where they group: three digits after each, as "1,234" and "1 234 567". Anything else ("3,40" typed where the comma groups)
  // is refused and not read as 340, because an amount that is a hundred times too large is the worst thing a typo can do.
  const marksOfGroups = group.filter((mark) => mark !== decimal);
  if (marksOfGroups.some((mark) => whole.includes(mark))) {
    const class_ = `[${marksOfGroups.map((mark) => mark.replace(/[\\\]^-]/g, '\\$&')).join('')}]`;
    if (!new RegExp(`^\\d{1,3}(?:${class_}\\d{3})+$`).test(whole)) return null;
    for (const mark of marksOfGroups) whole = whole.split(mark).join('');
  }
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null;
  if (whole === '' && fraction === '') return null;
  if (fraction.length > decimals) return null;
  const minor = BigInt(`${whole || '0'}${fraction.padEnd(decimals, '0')}`);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const signed = negative ? -Number(minor) : Number(minor);
  return Object.is(signed, -0) ? 0 : signed;
}
