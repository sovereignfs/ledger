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
  readonly type: 'expense' | 'income' | 'transfer';
  /** The whole amount, in minor units of the account's currency, more than nothing; `null` while not typed. For a transfer, what left the account. */
  readonly amount: number | null;
  /** The account that paid, or received, or (for a transfer) the one the money leaves. */
  readonly accountId: string;
  readonly currency: string;
  /** A transfer's other account, the one the money goes to, and its currency. */
  readonly toAccountId: string;
  readonly toCurrency: string;
  /** What arrived, in the other account's currency, when it is not the same currency as what left (DESIGN.md §6.8); ignored when it is. */
  readonly received: number | null;
  /** An expense that is money back: the account goes up and the subcategory down (a negative expense, DESIGN.md §6.2). */
  readonly refund: boolean;
  /** For an entry that is not split: its one subcategory or income source. */
  readonly targetId: string;
  /** Whether the amount is split in parts, which then stand in place of `targetId`. */
  readonly split: boolean;
  readonly parts: readonly Part[];
  readonly date: string;
  readonly note: string;
  /** Who was paid, as typed: a known payee's name or a new one, which is made when the entry is saved (DESIGN.md §6.5). Empty for none. */
  readonly payee: string;
  /** The jar an expense is paid from (DESIGN.md §10.2); empty for none. Only an expense that is not money back, from an account with that jar. */
  readonly jarId: string;
}

/** A jar the form may offer: what it holds, and the account it is in. */
export interface JarChoice {
  readonly id: string;
  readonly name: string;
  readonly accountId: string;
  readonly balance: number;
}

/** The jars the form offers: those in the chosen account, for an expense that is not money back. */
export function jarsFor(
  form: Pick<EntryForm, 'type' | 'refund' | 'accountId'>,
  jars: readonly JarChoice[],
): JarChoice[] {
  return form.type === 'expense' && !form.refund
    ? jars.filter((jar) => jar.accountId === form.accountId)
    : [];
}

/**
 * What is wrong with paying from the jar chosen, or `undefined`: **more than the jar holds is refused before it is sent**. An entry that was paid from this jar already
 * (`was`) counts what it took, since changing it gives that back first.
 */
export function jarProblem(
  form: EntryForm,
  jars: readonly JarChoice[],
  was: { readonly jarId: string; readonly amount: number } | null = null,
): string | undefined {
  if (form.jarId === '') return undefined;
  const jar = jarsFor(form, jars).find((each) => each.id === form.jarId);
  if (!jar) return 'That jar is not in this account.';
  const holds = jar.balance + (was && was.jarId === jar.id ? was.amount : 0);
  if ((form.amount ?? 0) > holds)
    return `The ${jar.name} jar holds ${decimalText(holds, form.currency)} ${form.currency}. Choose another jar, or a smaller amount.`;
  return undefined;
}

/** A form with nothing in it, which the forms read back start from. */
const BLANK_FORM: EntryForm = {
  type: 'expense',
  amount: null,
  accountId: '',
  currency: 'USD',
  toAccountId: '',
  toCurrency: 'USD',
  received: null,
  refund: false,
  targetId: '',
  split: false,
  parts: [],
  date: '',
  note: '',
  payee: '',
  jarId: '',
};

/** What is left of the amount when the parts are taken off it: more than nothing while they fall short, below nothing when they go over. */
export function remainder(form: Pick<EntryForm, 'amount' | 'parts'>): number {
  const parts = form.parts.reduce((sum, part) => sum + (part.amount ?? 0), 0);
  return (form.amount ?? 0) - parts;
}

/** The sentence that says what is missing from a form, or `undefined` when it can be sent. */
export function missing(
  form: EntryForm,
  jars: readonly JarChoice[] = [],
  was: { readonly jarId: string; readonly amount: number } | null = null,
): string | undefined {
  if (form.type === 'transfer') {
    if (form.accountId === '') return 'Choose the account the money comes from.';
    if (form.toAccountId === '') return 'Choose the account the money goes to.';
    if (form.toAccountId === form.accountId) return 'A transfer is between two different accounts.';
    if (form.amount === null || form.amount <= 0) return 'Enter the amount.';
    if (differs(form) && (form.received === null || form.received <= 0))
      return 'Enter the amount that arrived.';
    if (form.date === '') return 'Enter the date.';
    return undefined;
  }
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
  return jarProblem(form, jars, was);
}

/** Whether a transfer is between two currencies, which then records both amounts (DESIGN.md §6.8). */
export const differs = (form: Pick<EntryForm, 'currency' | 'toCurrency'>): boolean =>
  form.currency !== form.toCurrency;

/** The entry the form means: the account's line, and one line for the target, or for each part, in the account's currency; or a transfer's two. */
export function compose(form: EntryForm): TxnInput {
  const amount = form.amount ?? 0;
  const note = form.note.trim() === '' ? null : form.note.trim();
  if (form.type === 'transfer') {
    return {
      type: 'transfer',
      date: form.date,
      lines: [
        { account: form.accountId, amount: -amount, currency: form.currency },
        {
          account: form.toAccountId,
          amount: differs(form) ? (form.received ?? 0) : amount,
          currency: form.toCurrency,
        },
      ],
      note,
      payee: null,
    };
  }
  const expense = form.type === 'expense';
  // Money out, unless an expense is a refund: then the account goes up and each subcategory down.
  const sign = expense && !form.refund ? -1 : 1;
  const account: LineInput = {
    account: form.accountId,
    amount: sign * amount,
    currency: form.currency,
  };
  const parts = form.split ? form.parts : [{ targetId: form.targetId, amount }];
  const lines: LineInput[] = parts.map(({ targetId, amount: part }) =>
    expense
      ? { subcategory: targetId, amount: -sign * (part ?? 0), currency: form.currency }
      : { incomeSource: targetId, amount: -(part ?? 0), currency: form.currency },
  );
  return {
    type: form.type,
    date: form.date,
    lines: [account, ...lines],
    note,
    payee: form.payee.trim() === '' ? null : form.payee.trim(),
    // Always said for an expense, so that a change can take the jar off: the jar, or none.
    ...(expense ? { fromJar: !form.refund && form.jarId !== '' ? form.jarId : null } : {}),
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
  if (entry.type === 'transfer')
    return (
      entry.original === null &&
      entry.lines.length === 2 &&
      entry.lines.every((line) => line.account !== undefined)
    );
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
  payee?: { name: string } | null;
  fromJar?: { id: string } | null;
  lines: readonly LineInput[];
}): EntryForm {
  if (entry.type === 'transfer') {
    const from = entry.lines.find((line) => line.amount < 0) ?? entry.lines[0];
    const to = entry.lines.find((line) => line !== from);
    return {
      ...BLANK_FORM,
      type: 'transfer',
      amount: Math.abs(from?.amount ?? 0),
      accountId: from?.account ?? '',
      currency: from?.currency ?? 'USD',
      toAccountId: to?.account ?? '',
      toCurrency: to?.currency ?? 'USD',
      received: Math.abs(to?.amount ?? 0),
      date: entry.date,
      note: entry.note ?? '',
    };
  }
  const [account, ...targets] = entry.lines;
  const parts: Part[] = targets.map((line) => ({
    targetId: line.subcategory ?? line.incomeSource ?? '',
    amount: Math.abs(line.amount),
  }));
  const split = parts.length > 1;
  return {
    ...BLANK_FORM,
    type: entry.type === 'income' ? 'income' : 'expense',
    refund: entry.type === 'expense' && (account?.amount ?? 0) > 0,
    amount: Math.abs(account?.amount ?? 0),
    accountId: account?.account ?? '',
    currency: account?.currency ?? 'USD',
    targetId: split ? '' : (parts[0]?.targetId ?? ''),
    split,
    parts: split ? parts : [],
    date: entry.date,
    note: entry.note ?? '',
    payee: entry.payee?.name ?? '',
    jarId: entry.fromJar?.id ?? '',
  };
}
