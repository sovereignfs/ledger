import type { LineInput, TxnInput } from '../ledger/validate';

/**
 * What the add dialog turns its form into (DESIGN.md §14.4): **an expense is the account down and the subcategory up by the same amount; an income is the
 * account up and the income source down**. The amount is what a person typed, positive; the signs are made here, once, and the server holds the lines to
 * adding up. Pure, so it is tested with no browser.
 */
export interface EntryForm {
  readonly type: 'expense' | 'income';
  /** Minor units of the account's currency, more than nothing; `null` while not typed. */
  readonly amount: number | null;
  readonly accountId: string;
  readonly currency: string;
  /** A subcategory for an expense, an income source for an income. */
  readonly targetId: string;
  readonly date: string;
  readonly note: string;
}

/** The sentence that says what is missing from a form, or `undefined` when it can be sent. */
export function missing(form: EntryForm): string | undefined {
  if (form.accountId === '') return 'Choose the account.';
  if (form.amount === null || form.amount <= 0) return 'Enter the amount.';
  if (form.targetId === '')
    return form.type === 'expense' ? 'Choose the subcategory.' : 'Choose the income source.';
  if (form.date === '') return 'Enter the date.';
  return undefined;
}

/** The entry the form means: two lines, the account's and the target's, in the account's currency. */
export function compose(form: EntryForm): TxnInput {
  const amount = form.amount ?? 0;
  const account: LineInput = {
    account: form.accountId,
    amount: form.type === 'expense' ? -amount : amount,
    currency: form.currency,
  };
  const target: LineInput =
    form.type === 'expense'
      ? { subcategory: form.targetId, amount, currency: form.currency }
      : { incomeSource: form.targetId, amount: -amount, currency: form.currency };
  return {
    type: form.type,
    date: form.date,
    lines: [account, target],
    note: form.note.trim() === '' ? null : form.note.trim(),
  };
}

/**
 * Whether an entry read back is one this dialog can edit: an expense or an income of exactly two lines, an account and its subcategory or income source, with no
 * original amount. Splits (4.4), transfers (4.6) and the entries made by reconciling have their own forms.
 */
export function editable(entry: {
  type: string;
  original: unknown;
  lines: readonly LineInput[];
}): boolean {
  if (entry.type !== 'expense' && entry.type !== 'income') return false;
  if (entry.original !== null || entry.lines.length !== 2) return false;
  const [first, second] = entry.lines;
  if (!first || !second || first.account === undefined) return false;
  return entry.type === 'expense'
    ? second.subcategory !== undefined
    : second.incomeSource !== undefined;
}

/** The form an editable entry fills in: the amount is what the account lost or gained, as a positive number. */
export function formOf(entry: {
  type: string;
  date: string;
  note: string | null;
  lines: readonly LineInput[];
}): EntryForm {
  const [account, target] = entry.lines;
  return {
    type: entry.type === 'income' ? 'income' : 'expense',
    amount: Math.abs(account?.amount ?? 0),
    accountId: account?.account ?? '',
    currency: account?.currency ?? 'USD',
    targetId: target?.subcategory ?? target?.incomeSource ?? '',
    date: entry.date,
    note: entry.note ?? '',
  };
}
