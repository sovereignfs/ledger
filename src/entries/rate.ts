import { divideRoundHalfEven } from '../money/amount';
import { currencyDecimals } from '../money/currencies';

/**
 * The rate a transfer between two currencies implied (DESIGN.md §6.8): **the ratio of the amount that arrived to the amount that left**, shown and never
 * stored apart. Worked in integers, so it is exact: a whole number of millionths, rounded half to even, and written without trailing zeros. Pure.
 *
 *   impliedRate(10000, 'USD', 9000, 'EUR')   // '0.9'    (1 USD = 0.9 EUR)
 *   impliedRate(10000, 'USD', 1543800, 'JPY') // '154.38'
 */
export function impliedRate(
  sent: number,
  fromCurrency: string,
  received: number,
  toCurrency: string,
): string | undefined {
  if (!Number.isSafeInteger(sent) || !Number.isSafeInteger(received) || sent <= 0 || received <= 0)
    return undefined;
  const from = BigInt(currencyDecimals(fromCurrency));
  const to = BigInt(currencyDecimals(toCurrency));
  // (received / 10^to) / (sent / 10^from), in millionths.
  const millionths = divideRoundHalfEven(
    BigInt(received) * 10n ** (from + 6n),
    BigInt(sent) * 10n ** to,
  );
  const digits = millionths.toString().padStart(7, '0');
  const whole = digits.slice(0, -6);
  const fraction = digits.slice(-6).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/** "1 USD = 0.9 EUR", or `undefined` while either amount is missing. */
export function sayRate(
  sent: number | null,
  fromCurrency: string,
  received: number | null,
  toCurrency: string,
): string | undefined {
  if (sent === null || received === null) return undefined;
  const rate = impliedRate(sent, fromCurrency, received, toCurrency);
  return rate === undefined ? undefined : `1 ${fromCurrency} = ${rate} ${toCurrency}`;
}
