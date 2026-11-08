'use client';

import { CurrencyInput } from '@sovereignfs/ui';
import type { ComponentProps } from 'react';
import { currencyDecimals } from '../money/currencies';

type CurrencyInputProps = ComponentProps<typeof CurrencyInput>;

/**
 * `CurrencyInput` bound to a currency's own fraction digits (DESIGN.md §9.1).
 *
 * An amount is an integer count of the currency's smallest unit, and how many of those make one major unit is not a constant: ISO 4217 gives JPY and KRW zero
 * and BHD, KWD and TND three. `CurrencyInput` takes that as its `decimals` prop (defaulting to 2, which would record yen a hundred times too small); this
 * wrapper supplies it from `currencyDecimals`, so the lookup lives in one place and not at every field.
 *
 * `currency` is required for exactly that reason: a field that cannot say which currency it edits has no business being a money field, and the compiler
 * enforces it. `src/ui/money-input.test.ts` keeps new code going through here and not to `CurrencyInput` directly.
 *
 * A thin binding and not a reimplementation: the control stays in the design system (DS-first), and this adds only the app's own currency table to it.
 */
export function MoneyInput({
  currency,
  ...rest
}: Omit<CurrencyInputProps, 'decimals'> & { currency: string }) {
  return <CurrencyInput {...rest} decimals={currencyDecimals(currency)} />;
}
