import { isCalendarDay } from '../dates';
import { isMinor } from '../money/amount';
import { isSupportedCurrencyCode } from '../money/currencies';

/**
 * The kinds of money account (DESIGN.md §6.1), their sides, and what may be said of a new or changed one: **pure**, no database. A refusal is a sentence.
 */
export const ACCOUNT_TYPES = [
  'bank',
  'cash',
  'savings',
  'deposit',
  'investment',
  'property',
  'credit_card',
  'loan',
  'person',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type Side = 'asset' | 'liability' | 'either';

/** What a kind is, and which side of net worth it is on. A person's account is either: positive when they owe the owner, negative when the owner owes them. */
export const ACCOUNT_KINDS: Record<AccountType, { label: string; side: Side; hint: string }> = {
  bank: { label: 'Bank account', side: 'asset', hint: 'A current account.' },
  cash: { label: 'Cash', side: 'asset', hint: 'A wallet.' },
  savings: { label: 'Savings', side: 'asset', hint: 'Where jars usually live.' },
  deposit: { label: 'Deposit', side: 'asset', hint: 'Money held as security.' },
  investment: { label: 'Investment', side: 'asset', hint: 'Shares, funds or a pension.' },
  property: { label: 'Property', side: 'asset', hint: 'A car or a flat.' },
  credit_card: { label: 'Credit card', side: 'liability', hint: 'With a limit to use up to.' },
  loan: { label: 'Loan', side: 'liability', hint: 'Paid back in instalments.' },
  person: { label: 'Person', side: 'either', hint: 'Someone who owes you, or whom you owe.' },
};

export const isAccountType = (value: unknown): value is AccountType =>
  typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value);

export const MAX_NAME = 80;

/** What a loan is (DESIGN.md §6.1, §8.3). Amounts are minor units of the account's currency; `yearlyRate` is a percentage as decimal text, never a float. */
export interface LoanTerms {
  readonly lender: string;
  readonly principal: number;
  readonly startDate: string;
  readonly endDate: string;
  readonly instalment: number;
  readonly yearlyRate: string | null;
  readonly interestSubcategoryId: string | null;
}

export interface NewAccount {
  readonly type: AccountType;
  readonly name: string;
  readonly institution?: string | null;
  readonly currency: string;
  /** A credit card's limit, in minor units. */
  readonly creditLimit?: number | null;
  /** What is in the account on a day, **signed** as a balance is: negative for what is owed on a card or a loan. Nothing is written for zero. */
  readonly opening?: { readonly amount: number; readonly date: string } | null;
  readonly loan?: LoanTerms | null;
}

export interface AccountPatch {
  readonly name?: string;
  readonly institution?: string | null;
  readonly creditLimit?: number | null;
  /** A loan's terms that may change: not the principal or the start, which are what the account was made from. */
  readonly loan?: Partial<Pick<LoanTerms, 'lender' | 'endDate' | 'instalment' | 'yearlyRate'>>;
}

const RATE = /^(?:\d{1,2}|100)(?:\.\d{1,6})?$/;

const nameProblem = (name: unknown): string | undefined =>
  typeof name !== 'string' || name.trim() === ''
    ? 'An account needs a name.'
    : name.trim().length > MAX_NAME
      ? `A name is at most ${MAX_NAME} characters.`
      : undefined;

const institutionProblem = (institution: unknown): string | undefined =>
  institution == null || (typeof institution === 'string' && institution.trim().length <= MAX_NAME)
    ? undefined
    : `An institution is at most ${MAX_NAME} characters.`;

function loanProblems(loan: Partial<LoanTerms>, whole: boolean, startDate?: string): string[] {
  const out: string[] = [];
  if (loan.lender !== undefined || whole) {
    const problem = nameProblem(loan.lender);
    if (problem) out.push('A loan needs a lender, in at most 80 characters.');
  }
  if (whole || loan.principal !== undefined)
    if (!isMinor(loan.principal) || loan.principal <= 0)
      out.push('The principal of a loan is more than nothing.');
  if (whole || loan.instalment !== undefined)
    if (!isMinor(loan.instalment) || loan.instalment <= 0)
      out.push('The instalment of a loan is more than nothing.');
  if (whole && (typeof loan.startDate !== 'string' || !isCalendarDay(loan.startDate)))
    out.push('The start of a loan is not a day.');
  if (whole || loan.endDate !== undefined) {
    if (typeof loan.endDate !== 'string' || !isCalendarDay(loan.endDate))
      out.push('The end of a loan is not a day.');
    else if (startDate !== undefined && loan.endDate < startDate)
      out.push('A loan does not end before it starts.');
  }
  if (loan.yearlyRate != null && !RATE.test(loan.yearlyRate))
    out.push('The yearly rate is a percentage from 0 to 100, in decimals, such as 4.25.');
  return out;
}

/** What is wrong with a new account, as sentences; empty for one that may be written. */
export function checkNewAccount(input: NewAccount): string[] {
  const problems: string[] = [];
  if (!isAccountType(input.type)) return ['The kind of account is not one there is.'];
  const name = nameProblem(input.name);
  if (name) problems.push(name);
  const institution = institutionProblem(input.institution);
  if (institution) problems.push(institution);
  if (typeof input.currency !== 'string' || !isSupportedCurrencyCode(input.currency))
    problems.push('The currency is not one.');
  if (input.creditLimit != null) {
    if (input.type !== 'credit_card') problems.push('Only a credit card has a limit.');
    else if (!isMinor(input.creditLimit) || input.creditLimit <= 0)
      problems.push('The limit of a card is more than nothing.');
  }
  if (input.opening != null) {
    if (!isMinor(input.opening.amount)) problems.push('The opening balance is not an amount.');
    if (typeof input.opening.date !== 'string' || !isCalendarDay(input.opening.date))
      problems.push('The opening balance needs the day it is of.');
  }
  if (input.type === 'loan') {
    if (!input.loan) problems.push('A loan needs its lender, principal, dates and instalment.');
    else problems.push(...loanProblems(input.loan, true, input.loan.startDate));
  } else if (input.loan != null) problems.push('Only a loan has loan terms.');
  return [...new Set(problems)];
}

/** What is wrong with a change to an account of this type, as sentences. */
export function checkPatch(type: AccountType, patch: AccountPatch, startDate?: string): string[] {
  const problems: string[] = [];
  if (patch.name !== undefined) {
    const name = nameProblem(patch.name);
    if (name) problems.push(name);
  }
  const institution = institutionProblem(patch.institution);
  if (institution) problems.push(institution);
  if (patch.creditLimit != null) {
    if (type !== 'credit_card') problems.push('Only a credit card has a limit.');
    else if (!isMinor(patch.creditLimit) || patch.creditLimit <= 0)
      problems.push('The limit of a card is more than nothing.');
  }
  if (patch.loan !== undefined) {
    if (type !== 'loan') problems.push('Only a loan has loan terms.');
    else problems.push(...loanProblems(patch.loan, false, startDate));
  }
  return [...new Set(problems)];
}
