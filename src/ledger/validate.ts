import { isCalendarDay } from '../dates';
import { isMinor, sumMinor } from '../money/amount';
import { isSupportedCurrencyCode } from '../money/currencies';
import { decimalText } from '../money/text';
import { checkPayeeName } from './payee-write';

/**
 * What a transaction may be (DESIGN.md §6.2, §6.3, §6.8), as **pure functions** over the input: no database, no clock. `checkShape` is what can be said of the
 * input alone, `checkAccounts` is what needs to know the accounts its lines name (their type and currency). The one write path
 * (`src/ledger/transactions.ts`) runs both and writes nothing that either refuses; each refusal is **a sentence** a person can read, and none names a thing of
 * a book.
 *
 * The invariants held here, which every later write inherits (recurring posting, jars, loans, import):
 *  - a line names **exactly one** target: an account, a subcategory, an income source or equity;
 *  - an amount is a non-zero whole number of the currency's smallest unit;
 *  - the lines of a transaction **add up to zero in its currency**; the one exception is a transfer between two currencies, which records both amounts;
 *  - each type has the targets it may have and no others.
 */

export const TXN_TYPES = [
  'expense',
  'income',
  'transfer',
  'opening',
  'adjustment',
  'revaluation',
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const EQUITY_KINDS = ['opening', 'adjustment', 'revaluation'] as const;
export type Equity = (typeof EQUITY_KINDS)[number];

export const TXN_STATUSES = ['pending', 'cleared'] as const;
export type TxnStatus = (typeof TXN_STATUSES)[number];

/** A line as it comes in: exactly one of `account`, `subcategory`, `incomeSource` and `equity` is set. */
export interface LineInput {
  readonly account?: string;
  readonly subcategory?: string;
  readonly incomeSource?: string;
  readonly equity?: Equity;
  /** Signed, in minor units of `currency`: positive when an account's balance goes up. */
  readonly amount: number;
  readonly currency: string;
}

export interface TxnInput {
  readonly type: TxnType;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** In order: the first account line of an expense is the one that paid. */
  readonly lines: readonly LineInput[];
  readonly note?: string | null;
  /**
   * Who was paid, by name: the payee is made if the name is new (DESIGN.md §6.5). On a change, `undefined` keeps the payee the entry has and `null` removes it.
   */
  readonly payee?: string | null;
  /** Pending unless given; an opening and an adjustment are cleared (DESIGN.md §6.7). */
  readonly status?: TxnStatus;
  /** What was charged in another currency, for information only (§6.8); not on a transfer. */
  readonly original?: { readonly amount: number; readonly currency: string } | null;
}

/** The most lines a transaction has: a split receipt, not a ledger. */
export const MAX_LINES = 100;
export const MAX_NOTE = 1000;
const MAX_ID = 64;

/** The kind of a line's target, or `undefined` for a line that names none or more than one. */
export function targetOf(
  line: LineInput,
): 'account' | 'subcategory' | 'income_source' | 'equity' | undefined {
  const named = [
    line.account !== undefined && 'account',
    line.subcategory !== undefined && 'subcategory',
    line.incomeSource !== undefined && 'income_source',
    line.equity !== undefined && 'equity',
  ].filter(Boolean) as ('account' | 'subcategory' | 'income_source' | 'equity')[];
  return named.length === 1 ? named[0] : undefined;
}

/** The initial status of a transaction of this type when none is given (DESIGN.md §6.7). */
export function defaultStatus(type: TxnType): TxnStatus {
  return type === 'opening' || type === 'adjustment' ? 'cleared' : 'pending';
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID;

/** Every problem with the transaction that can be found without looking at a database: an empty list for one that may go on to be written. */
export function checkShape(input: TxnInput): string[] {
  const problems: string[] = [];
  if (!(TXN_TYPES as readonly string[]).includes(input.type)) {
    return ['The type of the entry is not one there is.'];
  }
  if (typeof input.date !== 'string' || !isCalendarDay(input.date))
    problems.push('The date is not a day.');
  if (input.note != null && (typeof input.note !== 'string' || input.note.length > MAX_NOTE))
    problems.push(`The note is longer than ${MAX_NOTE} characters.`);
  if (input.payee != null) {
    const problem = checkPayeeName(input.payee);
    if (problem) problems.push(problem);
  }
  if (input.status !== undefined && !(TXN_STATUSES as readonly string[]).includes(input.status))
    problems.push('The status is not pending or cleared.');
  if (!Array.isArray(input.lines) || input.lines.length < 2)
    return [...problems, 'An entry has at least two lines.'];
  if (input.lines.length > MAX_LINES)
    return [...problems, `An entry has at most ${MAX_LINES} lines.`];

  // Each line on its own: one target, a currency, a whole non-zero amount.
  let linesOk = true;
  for (const line of input.lines) {
    const target = targetOf(line);
    if (target === undefined) {
      problems.push(
        'Each line names exactly one of an account, a subcategory, an income source or equity.',
      );
      linesOk = false;
    } else if (
      (target === 'account' && !isId(line.account)) ||
      (target === 'subcategory' && !isId(line.subcategory)) ||
      (target === 'income_source' && !isId(line.incomeSource)) ||
      (target === 'equity' && !(EQUITY_KINDS as readonly string[]).includes(line.equity ?? ''))
    ) {
      problems.push('A line names something that is not there.');
      linesOk = false;
    }
    if (!isMinor(line.amount)) {
      problems.push('Each amount is a whole number of the currency’s smallest unit.');
      linesOk = false;
    } else if (line.amount === 0) {
      problems.push('A line of nothing is not a line.');
      linesOk = false;
    }
    if (typeof line.currency !== 'string' || !isSupportedCurrencyCode(line.currency)) {
      problems.push('A line is in a currency that is not one.');
      linesOk = false;
    }
  }
  if (input.original != null) {
    const { amount, currency } = input.original;
    if (input.type !== 'expense' && input.type !== 'income')
      problems.push('An original amount belongs to an expense or an income.');
    else if (!isMinor(amount) || amount === 0 || !isSupportedCurrencyCode(currency))
      problems.push('The original amount is not an amount in a currency.');
  }
  if (!linesOk) return dedupe(problems);

  const kinds = input.lines.map((line) => targetOf(line));
  const count = (kind: string) => kinds.filter((each) => each === kind).length;
  const accounts = count('account');
  const only = (...allowed: string[]) =>
    kinds.every((kind) => kind !== undefined && allowed.includes(kind));

  switch (input.type) {
    case 'expense':
      if (accounts < 1 || count('subcategory') < 1 || !only('account', 'subcategory'))
        problems.push('An expense has an account that paid and one or more subcategories.');
      break;
    case 'income':
      if (accounts !== 1 || count('income_source') < 1 || !only('account', 'income_source'))
        problems.push('An income has one account that received it and one or more income sources.');
      break;
    case 'transfer':
      if (accounts !== 2 || input.lines.length !== 2)
        problems.push('A transfer has two accounts, one down and one up, and nothing else.');
      else if (input.lines[0]?.account === input.lines[1]?.account)
        problems.push('A transfer is between two different accounts.');
      break;
    default: {
      // opening, adjustment, revaluation: one account and the matching equity.
      const equity = input.lines.find((line) => line.equity !== undefined)?.equity;
      if (accounts !== 1 || count('equity') !== 1 || input.lines.length !== 2)
        problems.push(`${titleOf(input.type)} has one account and equity, and nothing else.`);
      else if (equity !== input.type)
        problems.push(`The equity of ${titleOf(input.type).toLowerCase()} is its own.`);
    }
  }
  if (problems.length > 0) return dedupe(problems);

  problems.push(...checkSums(input));
  return dedupe(problems);
}

const titleOf = (type: TxnType) =>
  ({
    expense: 'An expense',
    income: 'An income',
    transfer: 'A transfer',
    opening: 'An opening balance',
    adjustment: 'An adjustment',
    revaluation: 'A new value',
  })[type];

/**
 * That the lines add up to nothing in the entry's currency (DESIGN.md §6.2). A transfer between two currencies is the one exception: its two lines are in
 * their accounts' currencies, one down and one up, and are not added together (§6.8).
 */
function checkSums(input: TxnInput): string[] {
  const currencies = new Set(input.lines.map((line) => line.currency));
  if (input.type === 'transfer' && currencies.size === 2) {
    const [a, b] = input.lines;
    return a && b && Math.sign(a.amount) === Math.sign(b.amount)
      ? ['A transfer takes an amount out of one account and puts one into the other.']
      : [];
  }
  if (currencies.size !== 1)
    return ['Every line of an entry is in one currency, the one of the account that paid.'];
  const [currency] = currencies;
  const sum = sumMinorSafe(input.lines.map((line) => line.amount));
  if (sum === undefined) return ['The lines are too large to add up.'];
  if (sum !== 0)
    return [
      `The lines add up to ${decimalText(sum, currency as string)} ${currency}, and they must add up to nothing: what comes out of one place goes into another.`,
    ];
  return [];
}

function sumMinorSafe(amounts: readonly number[]): number | undefined {
  try {
    return sumMinor(amounts);
  } catch {
    return undefined;
  }
}

/** The types of account a line may be on, by what an entry is (DESIGN.md §6.1, §6.2). */
const LIABILITY_TYPES = ['loan', 'credit_card'] as const;
const VALUED_TYPES = ['investment', 'property'] as const;

/** What the accounts a transaction names are, as the write path read them: their type and the one currency they have. */
export type AccountFacts = ReadonlyMap<
  string,
  { readonly type: string; readonly currency: string }
>;

/**
 * What is wrong with the transaction given the accounts it names, which the caller has found **in the book** (an account that is not there is a different
 * answer, not found, and is never asked of here). The lines on an account are in that account's currency; an expense may also carry a line on a liability,
 * which is how a loan instalment is one entry; a new value is of an investment or a property.
 */
export function checkAccounts(input: TxnInput, accounts: AccountFacts): string[] {
  const problems: string[] = [];
  const accountLines = input.lines.filter((line) => line.account !== undefined);
  for (const line of accountLines) {
    const facts = accounts.get(line.account as string);
    if (facts === undefined) continue;
    if (facts.currency !== line.currency)
      problems.push(
        `An amount is in ${line.currency} and its account is in ${facts.currency}: an account has one currency.`,
      );
  }
  if (input.type === 'expense') {
    for (const line of accountLines.slice(1)) {
      const type = accounts.get(line.account as string)?.type;
      if (type !== undefined && !(LIABILITY_TYPES as readonly string[]).includes(type))
        problems.push(
          'An expense may carry a second account only if it is owed: a loan or a credit card.',
        );
    }
    // Every line of an expense is in the currency of the account that paid.
    const payer = accounts.get(accountLines[0]?.account as string);
    if (payer && input.lines.some((line) => line.currency !== payer.currency))
      problems.push('Every line of an expense is in the currency of the account that paid.');
  }
  if (input.type === 'revaluation') {
    const type = accounts.get(accountLines[0]?.account as string)?.type;
    if (type !== undefined && !(VALUED_TYPES as readonly string[]).includes(type))
      problems.push('Only an investment or a property is given a new value.');
  }
  return dedupe(problems);
}

const dedupe = (problems: string[]) => [...new Set(problems)];
