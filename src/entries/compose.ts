import { decimalText } from '../money/text';
import type { LineInput, TxnInput } from '../ledger/validate';

/**
 * What the add dialog turns its form into (DESIGN.md §6.2, §14.4): **an expense is the account down and its subcategories up; an income is the account up and
 * its income sources down**. The amount is what a person typed, positive; the signs are made here, once, and the server holds the lines to adding up. A
 * payment can be **split** across several subcategories (or income sources): the parts must add up to the amount, and the form says what is left until they
 * do and refuses before it is sent. Pure, so it is tested with no browser.
 */
export interface Part {
  /** A subcategory for an expense, an income source for an income. */
  readonly targetId: string;
  /** Minor units of the account's currency, more than nothing; `null` while not typed. */
  readonly amount: number | null;
}

export interface EntryForm {
  readonly type: 'expense' | 'income';
  /** The whole amount, in minor units of the account's currency, more than nothing; `null` while not typed. */
  readonly amount: number | null;
  readonly accountId: string;
  readonly currency: string;
  /** For an entry that is not split: its one subcategory or income source. */
  readonly targetId: string;
  /** Whether the amount is split in parts, which then stand in place of `targetId`. */
  readonly split: boolean;
  readonly parts: readonly Part[];
  readonly date: string;
  readonly note: string;
}

/** What is left of the amount when the parts are taken off it: more than nothing while they fall short, below nothing when they go over. */
export function remainder(form: Pick<EntryForm, 'amount' | 'parts'>): number {
  const parts = form.parts.reduce((sum, part) => sum + (part.amount ?? 0), 0);
  return (form.amount ?? 0) - parts;
}

/** The sentence that says what is missing from a form, or `undefined` when it can be sent. */
export function missing(form: EntryForm): string | undefined {
  if (form.accountId === '') return 'Choose the account.';
  if (form.amount === null || form.amount <= 0) return 'Enter the amount.';
  const what = form.type === 'expense' ? 'subcategory' : 'income source';
  if (!form.split) {
    if (form.targetId === '') return `Choose the ${what}.`;
  } else {
    if (form.parts.length < 2) return 'A split has at least two parts.';
    for (const part of form.parts) {
      if (part.targetId === '') return `Choose the ${what} of each part.`;
      if (part.amount === null || part.amount <= 0) return 'Enter the amount of each part.';
    }
    const left = remainder(form);
    if (left !== 0) {
      const shown = `${decimalText(Math.abs(left), form.currency)} ${form.currency}`;
      return left > 0
        ? `The parts are ${shown} short: they must add up to the amount.`
        : `The parts are ${shown} over: they must add up to the amount.`;
    }
  }
  if (form.date === '') return 'Enter the date.';
  return undefined;
}

/** The entry the form means: the account's line, and one line for the target, or for each part, in the account's currency. */
export function compose(form: EntryForm): TxnInput {
  const amount = form.amount ?? 0;
  const expense = form.type === 'expense';
  const account: LineInput = {
    account: form.accountId,
    amount: expense ? -amount : amount,
    currency: form.currency,
  };
  const parts = form.split ? form.parts : [{ targetId: form.targetId, amount }];
  const lines: LineInput[] = parts.map(({ targetId, amount: part }) =>
    expense
      ? { subcategory: targetId, amount: part ?? 0, currency: form.currency }
      : { incomeSource: targetId, amount: -(part ?? 0), currency: form.currency },
  );
  return {
    type: form.type,
    date: form.date,
    lines: [account, ...lines],
    note: form.note.trim() === '' ? null : form.note.trim(),
  };
}

/**
 * Whether an entry read back is one this dialog can edit: an expense or an income of an account and then only subcategories (or only income sources), one or
 * several, with no original amount. Transfers (4.6) and the entries made by reconciling have their own forms.
 */
export function editable(entry: {
  type: string;
  original: unknown;
  lines: readonly LineInput[];
}): boolean {
  if (entry.type !== 'expense' && entry.type !== 'income') return false;
  if (entry.original !== null || entry.lines.length < 2) return false;
  const [first, ...rest] = entry.lines;
  if (!first || first.account === undefined) return false;
  return rest.every((line) =>
    entry.type === 'expense'
      ? line.subcategory !== undefined && line.account === undefined
      : line.incomeSource !== undefined && line.account === undefined,
  );
}

/** The form an editable entry fills in: the amount is what the account lost or gained, as a positive number, and several lines are a split. */
export function formOf(entry: {
  type: string;
  date: string;
  note: string | null;
  lines: readonly LineInput[];
}): EntryForm {
  const [account, ...targets] = entry.lines;
  const parts: Part[] = targets.map((line) => ({
    targetId: line.subcategory ?? line.incomeSource ?? '',
    amount: Math.abs(line.amount),
  }));
  const split = parts.length > 1;
  return {
    type: entry.type === 'income' ? 'income' : 'expense',
    amount: Math.abs(account?.amount ?? 0),
    accountId: account?.account ?? '',
    currency: account?.currency ?? 'USD',
    targetId: split ? '' : (parts[0]?.targetId ?? ''),
    split,
    parts: split ? parts : [],
    date: entry.date,
    note: entry.note ?? '',
  };
}
