'use client';

import Link from 'next/link';
import { Button, FormField, Input, Select } from '@sovereignfs/ui';
import type { EntryOptions } from '../ledger/entries';
import { ENTRY_TYPE_LABEL } from '../accounts/words';
import { TXN_TYPES } from '../ledger/validate';
import type { EntryFilter } from './filter';
import styles from './Transactions.module.css';

/**
 * The filters of the list (DESIGN.md §6.9) as a plain form that **asks with `GET`**, so the address holds the view and a reload, a bookmark or a shared link
 * is the same one. It needs no script. A category or one of its subcategories is one choice: a category takes in its subcategories.
 */
export function FilterBar({
  filter,
  options,
}: {
  filter: EntryFilter;
  options: Pick<EntryOptions, 'transferAccounts' | 'categories'>;
}) {
  const chosen = filter.subcategory
    ? `s:${filter.subcategory}`
    : filter.category
      ? `c:${filter.category}`
      : '';
  return (
    <form method="get" action="/transactions" className={styles.filters} aria-label="Filters">
      <FormField label="Account">
        {(field) => (
          <Select {...field} name="account" defaultValue={filter.account ?? ''}>
            <option value="">Every account</option>
            {options.transferAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label="Category">
        {(field) => (
          <Select {...field} name="category" defaultValue={chosen}>
            <option value="">Every category</option>
            {options.categories.map((category) => (
              <optgroup key={category.id} label={category.name}>
                <option value={`c:${category.id}`}>All of {category.name}</option>
                {category.subcategories.map((sub) => (
                  <option key={sub.id} value={`s:${sub.id}`}>
                    {sub.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label="Type">
        {(field) => (
          <Select {...field} name="type" defaultValue={filter.type ?? ''}>
            <option value="">Every type</option>
            {TXN_TYPES.map((type) => (
              <option key={type} value={type}>
                {ENTRY_TYPE_LABEL[type] ?? type}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label="Status">
        {(field) => (
          <Select {...field} name="status" defaultValue={filter.status ?? ''}>
            <option value="">Pending or cleared</option>
            <option value="pending">Pending</option>
            <option value="cleared">Cleared</option>
          </Select>
        )}
      </FormField>
      <FormField label="From">
        {(field) => <Input {...field} name="from" type="date" defaultValue={filter.from ?? ''} />}
      </FormField>
      <FormField label="To">
        {(field) => <Input {...field} name="to" type="date" defaultValue={filter.to ?? ''} />}
      </FormField>
      <FormField label="Payee or note">
        {(field) => <Input {...field} name="q" defaultValue={filter.q ?? ''} maxLength={100} />}
      </FormField>
      {filter.payee ? <input type="hidden" name="payee" value={filter.payee} /> : null}
      <span className={styles.buttons}>
        <Button type="submit">Apply</Button>
        <Link href="/transactions">Clear</Link>
      </span>
    </form>
  );
}
