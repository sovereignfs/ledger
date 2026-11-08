'use client';

import { Combobox } from '@sovereignfs/ui';
import { CURRENCY_OPTIONS, type CurrencyOption } from '../money/currencies';

/**
 * The currency chooser, as one component rather than a copy of the same `Select` at every place that asks (DESIGN.md §9.1).
 *
 * `Combobox`, not `Select`: the list is ICU's full ISO 4217 set, which is far too long to scroll to find NZD; the design system draws that line itself ("for a
 * fixed, short option list where search adds no value, use `Select`"). The code goes in the label, not only the value, because `Combobox` filters on the
 * label alone: someone typing "USD" has to match, and so does someone typing "dollar".
 *
 * `options` is a prop and not always the full list: a dialog that adds a currency a book does not use yet passes only the codes it has not added.
 */
export function CurrencyPicker({
  value,
  onChange,
  options = CURRENCY_OPTIONS,
  'aria-label': ariaLabel = 'Currency',
  ...rest
}: {
  value: string;
  onChange: (code: string) => void;
  options?: readonly CurrencyOption[];
  'aria-label'?: string;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <Combobox
      {...rest}
      aria-label={ariaLabel}
      value={value || null}
      onChange={onChange}
      options={options.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
      placeholder="Select a currency…"
      searchPlaceholder="Search by code or name…"
      emptyMessage="No currency matches that."
    />
  );
}
