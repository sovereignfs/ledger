import { isSupportedCurrencyCode } from '../money/currencies';

/**
 * What setup guesses from the browser (DESIGN.md §15.3), **pure**: the base currency from the locale's region, and whether a time zone is one. A guess is only
 * a starting point that the person confirms; where it cannot be made, the answer is US dollars.
 */
const EURO = [
  'AT',
  'BE',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
];

const BY_REGION: Record<string, string> = {
  US: 'USD',
  GB: 'GBP',
  CA: 'CAD',
  AU: 'AUD',
  NZ: 'NZD',
  JP: 'JPY',
  CN: 'CNY',
  IN: 'INR',
  KR: 'KRW',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  BR: 'BRL',
  MX: 'MXN',
  ZA: 'ZAR',
  SG: 'SGD',
  HK: 'HKD',
  AE: 'AED',
  LK: 'LKR',
  TR: 'TRY',
  ...Object.fromEntries(EURO.map((region) => [region, 'EUR'])),
};

/** The currency of a locale's region (`en-GB` is pounds, `de-DE` euros), or dollars when the locale names none we know. Never a code that is not a currency. */
export function currencyForLocale(locale: string | undefined): string {
  const region = /^[a-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})\b/
    .exec(locale ?? '')?.[1]
    ?.toUpperCase();
  const found = region ? BY_REGION[region] : undefined;
  return found && isSupportedCurrencyCode(found) ? found : 'USD';
}

/** Whether a name is an IANA time zone this runtime knows. */
export function isTimeZone(name: unknown): name is string {
  if (typeof name !== 'string' || name === '' || name.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
