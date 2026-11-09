'use client';

import { Select } from '@sovereignfs/ui';
import type { ComponentProps } from 'react';
import type { EntryOptions } from '../ledger/entries';

/** The choice of a subcategory (grouped by category) for an expense, or an income source for an income: one component for the form and for each part of a split. */
export function TargetSelect({
  options,
  expense,
  value,
  onChange,
  ...rest
}: Omit<ComponentProps<typeof Select>, 'value' | 'onChange' | 'children'> & {
  options: EntryOptions | null;
  expense: boolean;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Select {...rest} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{expense ? 'Choose a subcategory' : 'Choose an income source'}</option>
      {expense
        ? options?.categories
            .filter((category) => category.subcategories.length > 0)
            .map((category) => (
              <optgroup key={category.id} label={category.name}>
                {category.subcategories.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}
                  </option>
                ))}
              </optgroup>
            ))
        : options?.incomeSources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
    </Select>
  );
}
