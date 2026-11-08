// GENERATED FILE — do not edit by hand.
// Regenerate with `pnpm generate:currencies`; the generator's own doc comment explains the sources.

/**
 * The single pivot every `fx_rate` row is stored against (DESIGN.md §9.2): USD, since Frankfurter quotes every currency against it. A rate between any two
 * currencies is derived from their two legs at the date (`src/fx`, task 3.3).
 */
export const FX_PIVOT_CODE = 'USD';

export interface CurrencyOption {
  code: string;
  name: string;
  /**
   * Fraction digits this currency uses: the exponent relating a stored amount in minor units to the amount a person reads. **Not uniformly 2**: ISO 4217
   * gives JPY, KRW, CLP and ISK zero and BHD, KWD and TND three. Every amount is stored as an integer count of this currency's smallest unit, so this is
   * what both `formatMoney` and `CurrencyInput`'s `decimals` prop need.
   */
  decimals: number;
}

/**
 * Every currency selectable anywhere in Ledger: ICU's ISO 4217 set, with no crypto (DESIGN.md §9.1). A book uses the ones its accounts and categories name
 * (`book_currency`); the daily rate job fetches exactly those (task 3.3), not this whole list.
 */
export const CURRENCY_OPTIONS: readonly CurrencyOption[] = [
  { code: 'AED', name: 'United Arab Emirates Dirham', decimals: 2 },
  { code: 'AFN', name: 'Afghan Afghani', decimals: 0 },
  { code: 'ALL', name: 'Albanian Lek', decimals: 0 },
  { code: 'AMD', name: 'Armenian Dram', decimals: 2 },
  { code: 'ANG', name: 'Netherlands Antillean Guilder', decimals: 2 },
  { code: 'AOA', name: 'Angolan Kwanza', decimals: 2 },
  { code: 'ARS', name: 'Argentine Peso', decimals: 2 },
  { code: 'AUD', name: 'Australian Dollar', decimals: 2 },
  { code: 'AWG', name: 'Aruban Florin', decimals: 2 },
  { code: 'AZN', name: 'Azerbaijani Manat', decimals: 2 },
  { code: 'BAM', name: 'Bosnia-Herzegovina Convertible Mark', decimals: 2 },
  { code: 'BBD', name: 'Barbadian Dollar', decimals: 2 },
  { code: 'BDT', name: 'Bangladeshi Taka', decimals: 2 },
  { code: 'BGN', name: 'Bulgarian Lev', decimals: 2 },
  { code: 'BHD', name: 'Bahraini Dinar', decimals: 3 },
  { code: 'BIF', name: 'Burundian Franc', decimals: 0 },
  { code: 'BMD', name: 'Bermudan Dollar', decimals: 2 },
  { code: 'BND', name: 'Brunei Dollar', decimals: 2 },
  { code: 'BOB', name: 'Bolivian Boliviano', decimals: 2 },
  { code: 'BRL', name: 'Brazilian Real', decimals: 2 },
  { code: 'BSD', name: 'Bahamian Dollar', decimals: 2 },
  { code: 'BTN', name: 'Bhutanese Ngultrum', decimals: 2 },
  { code: 'BWP', name: 'Botswanan Pula', decimals: 2 },
  { code: 'BYN', name: 'Belarusian Ruble', decimals: 2 },
  { code: 'BZD', name: 'Belize Dollar', decimals: 2 },
  { code: 'CAD', name: 'Canadian Dollar', decimals: 2 },
  { code: 'CDF', name: 'Congolese Franc', decimals: 2 },
  { code: 'CHF', name: 'Swiss Franc', decimals: 2 },
  { code: 'CLP', name: 'Chilean Peso', decimals: 0 },
  { code: 'CNY', name: 'Chinese Yuan', decimals: 2 },
  { code: 'COP', name: 'Colombian Peso', decimals: 0 },
  { code: 'CRC', name: 'Costa Rican Colón', decimals: 2 },
  { code: 'CUC', name: 'Cuban Convertible Peso', decimals: 2 },
  { code: 'CUP', name: 'Cuban Peso', decimals: 2 },
  { code: 'CVE', name: 'Cape Verdean Escudo', decimals: 2 },
  { code: 'CZK', name: 'Czech Koruna', decimals: 2 },
  { code: 'DJF', name: 'Djiboutian Franc', decimals: 0 },
  { code: 'DKK', name: 'Danish Krone', decimals: 2 },
  { code: 'DOP', name: 'Dominican Peso', decimals: 2 },
  { code: 'DZD', name: 'Algerian Dinar', decimals: 2 },
  { code: 'EGP', name: 'Egyptian Pound', decimals: 2 },
  { code: 'ERN', name: 'Eritrean Nakfa', decimals: 2 },
  { code: 'ETB', name: 'Ethiopian Birr', decimals: 2 },
  { code: 'EUR', name: 'Euro', decimals: 2 },
  { code: 'FJD', name: 'Fijian Dollar', decimals: 2 },
  { code: 'FKP', name: 'Falkland Islands Pound', decimals: 2 },
  { code: 'GBP', name: 'British Pound', decimals: 2 },
  { code: 'GEL', name: 'Georgian Lari', decimals: 2 },
  { code: 'GHS', name: 'Ghanaian Cedi', decimals: 2 },
  { code: 'GIP', name: 'Gibraltar Pound', decimals: 2 },
  { code: 'GMD', name: 'Gambian Dalasi', decimals: 2 },
  { code: 'GNF', name: 'Guinean Franc', decimals: 0 },
  { code: 'GTQ', name: 'Guatemalan Quetzal', decimals: 2 },
  { code: 'GYD', name: 'Guyanaese Dollar', decimals: 2 },
  { code: 'HKD', name: 'Hong Kong Dollar', decimals: 2 },
  { code: 'HNL', name: 'Honduran Lempira', decimals: 2 },
  { code: 'HRK', name: 'Croatian Kuna', decimals: 2 },
  { code: 'HTG', name: 'Haitian Gourde', decimals: 2 },
  { code: 'HUF', name: 'Hungarian Forint', decimals: 0 },
  { code: 'IDR', name: 'Indonesian Rupiah', decimals: 0 },
  { code: 'ILS', name: 'Israeli New Shekel', decimals: 2 },
  { code: 'INR', name: 'Indian Rupee', decimals: 2 },
  { code: 'IQD', name: 'Iraqi Dinar', decimals: 0 },
  { code: 'IRR', name: 'Iranian Rial', decimals: 0 },
  { code: 'ISK', name: 'Icelandic Króna', decimals: 0 },
  { code: 'JMD', name: 'Jamaican Dollar', decimals: 2 },
  { code: 'JOD', name: 'Jordanian Dinar', decimals: 3 },
  { code: 'JPY', name: 'Japanese Yen', decimals: 0 },
  { code: 'KES', name: 'Kenyan Shilling', decimals: 2 },
  { code: 'KGS', name: 'Kyrgyz Som', decimals: 2 },
  { code: 'KHR', name: 'Cambodian Riel', decimals: 2 },
  { code: 'KMF', name: 'Comorian Franc', decimals: 0 },
  { code: 'KPW', name: 'North Korean Won', decimals: 0 },
  { code: 'KRW', name: 'South Korean Won', decimals: 0 },
  { code: 'KWD', name: 'Kuwaiti Dinar', decimals: 3 },
  { code: 'KYD', name: 'Cayman Islands Dollar', decimals: 2 },
  { code: 'KZT', name: 'Kazakhstani Tenge', decimals: 2 },
  { code: 'LAK', name: 'Laotian Kip', decimals: 0 },
  { code: 'LBP', name: 'Lebanese Pound', decimals: 0 },
  { code: 'LKR', name: 'Sri Lankan Rupee', decimals: 2 },
  { code: 'LRD', name: 'Liberian Dollar', decimals: 2 },
  { code: 'LSL', name: 'Lesotho Loti', decimals: 2 },
  { code: 'LYD', name: 'Libyan Dinar', decimals: 3 },
  { code: 'MAD', name: 'Moroccan Dirham', decimals: 2 },
  { code: 'MDL', name: 'Moldovan Leu', decimals: 2 },
  { code: 'MGA', name: 'Malagasy Ariary', decimals: 0 },
  { code: 'MKD', name: 'Macedonian Denar', decimals: 2 },
  { code: 'MMK', name: 'Myanmar Kyat', decimals: 0 },
  { code: 'MNT', name: 'Mongolian Tugrik', decimals: 2 },
  { code: 'MOP', name: 'Macanese Pataca', decimals: 2 },
  { code: 'MRU', name: 'Mauritanian Ouguiya', decimals: 2 },
  { code: 'MUR', name: 'Mauritian Rupee', decimals: 2 },
  { code: 'MVR', name: 'Maldivian Rufiyaa', decimals: 2 },
  { code: 'MWK', name: 'Malawian Kwacha', decimals: 2 },
  { code: 'MXN', name: 'Mexican Peso', decimals: 2 },
  { code: 'MYR', name: 'Malaysian Ringgit', decimals: 2 },
  { code: 'MZN', name: 'Mozambican Metical', decimals: 2 },
  { code: 'NAD', name: 'Namibian Dollar', decimals: 2 },
  { code: 'NGN', name: 'Nigerian Naira', decimals: 2 },
  { code: 'NIO', name: 'Nicaraguan Córdoba', decimals: 2 },
  { code: 'NOK', name: 'Norwegian Krone', decimals: 2 },
  { code: 'NPR', name: 'Nepalese Rupee', decimals: 2 },
  { code: 'NZD', name: 'New Zealand Dollar', decimals: 2 },
  { code: 'OMR', name: 'Omani Rial', decimals: 3 },
  { code: 'PAB', name: 'Panamanian Balboa', decimals: 2 },
  { code: 'PEN', name: 'Peruvian Sol', decimals: 2 },
  { code: 'PGK', name: 'Papua New Guinean Kina', decimals: 2 },
  { code: 'PHP', name: 'Philippine Peso', decimals: 2 },
  { code: 'PKR', name: 'Pakistani Rupee', decimals: 0 },
  { code: 'PLN', name: 'Polish Zloty', decimals: 2 },
  { code: 'PYG', name: 'Paraguayan Guarani', decimals: 0 },
  { code: 'QAR', name: 'Qatari Riyal', decimals: 2 },
  { code: 'RON', name: 'Romanian Leu', decimals: 2 },
  { code: 'RSD', name: 'Serbian Dinar', decimals: 2 },
  { code: 'RUB', name: 'Russian Ruble', decimals: 2 },
  { code: 'RWF', name: 'Rwandan Franc', decimals: 0 },
  { code: 'SAR', name: 'Saudi Riyal', decimals: 2 },
  { code: 'SBD', name: 'Solomon Islands Dollar', decimals: 2 },
  { code: 'SCR', name: 'Seychellois Rupee', decimals: 2 },
  { code: 'SDG', name: 'Sudanese Pound', decimals: 2 },
  { code: 'SEK', name: 'Swedish Krona', decimals: 2 },
  { code: 'SGD', name: 'Singapore Dollar', decimals: 2 },
  { code: 'SHP', name: 'St. Helena Pound', decimals: 2 },
  { code: 'SLE', name: 'Sierra Leonean Leone', decimals: 2 },
  { code: 'SLL', name: 'Sierra Leonean Leone (1964—2022)', decimals: 0 },
  { code: 'SOS', name: 'Somali Shilling', decimals: 0 },
  { code: 'SRD', name: 'Surinamese Dollar', decimals: 2 },
  { code: 'SSP', name: 'South Sudanese Pound', decimals: 2 },
  { code: 'STN', name: 'São Tomé & Príncipe Dobra', decimals: 2 },
  { code: 'SVC', name: 'Salvadoran Colón', decimals: 2 },
  { code: 'SYP', name: 'Syrian Pound', decimals: 0 },
  { code: 'SZL', name: 'Swazi Lilangeni', decimals: 2 },
  { code: 'THB', name: 'Thai Baht', decimals: 2 },
  { code: 'TJS', name: 'Tajikistani Somoni', decimals: 2 },
  { code: 'TMT', name: 'Turkmenistani Manat', decimals: 2 },
  { code: 'TND', name: 'Tunisian Dinar', decimals: 3 },
  { code: 'TOP', name: 'Tongan Paʻanga', decimals: 2 },
  { code: 'TRY', name: 'Turkish Lira', decimals: 2 },
  { code: 'TTD', name: 'Trinidad & Tobago Dollar', decimals: 2 },
  { code: 'TWD', name: 'New Taiwan Dollar', decimals: 2 },
  { code: 'TZS', name: 'Tanzanian Shilling', decimals: 2 },
  { code: 'UAH', name: 'Ukrainian Hryvnia', decimals: 2 },
  { code: 'UGX', name: 'Ugandan Shilling', decimals: 0 },
  { code: 'USD', name: 'US Dollar', decimals: 2 },
  { code: 'UYU', name: 'Uruguayan Peso', decimals: 2 },
  { code: 'UZS', name: 'Uzbekistani Som', decimals: 2 },
  { code: 'VES', name: 'Venezuelan Bolívar', decimals: 2 },
  { code: 'VND', name: 'Vietnamese Dong', decimals: 0 },
  { code: 'VUV', name: 'Vanuatu Vatu', decimals: 0 },
  { code: 'WST', name: 'Samoan Tala', decimals: 2 },
  { code: 'XAF', name: 'Central African CFA Franc', decimals: 0 },
  { code: 'XCD', name: 'East Caribbean Dollar', decimals: 2 },
  { code: 'XCG', name: 'Caribbean guilder', decimals: 2 },
  { code: 'XOF', name: 'West African CFA Franc', decimals: 0 },
  { code: 'XPF', name: 'CFP Franc', decimals: 0 },
  { code: 'YER', name: 'Yemeni Rial', decimals: 0 },
  { code: 'ZAR', name: 'South African Rand', decimals: 2 },
  { code: 'ZMW', name: 'Zambian Kwacha', decimals: 2 },
  { code: 'ZWG', name: 'Zimbabwean Gold', decimals: 2 },
  { code: 'ZWL', name: 'Zimbabwean Dollar (2009–2024)', decimals: 2 },
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
