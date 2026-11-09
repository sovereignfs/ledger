import { formatMoney } from '../money/text';
import { ACCOUNT_KINDS, type AccountType } from './account-types';

/**
 * How a balance is **said** (DESIGN.md §6.1): never with a minus for money that is owed, but in words. A card at −420.00 is "420.00 used"; a loan is "left to pay";
 * a person's account says who owes whom. The sign stays in the data, where the arithmetic is, and these are the only words for it. Pure.
 */
export interface Said {
  /** What to show: an amount, without a minus for what is owed, and the words around it. */
  readonly text: string;
  /** `owed` for what the person owes, `owes_you` for what is owed to them, `normal` for the rest: a screen may colour them, and must not depend on colour to say it. */
  readonly tone: 'normal' | 'owed' | 'owes_you';
}

const abs = (value: number) => Math.abs(value);

export function sayBalance(
  type: AccountType,
  balance: number,
  currency: string,
  locale?: string,
): Said {
  const money = (value: number) => formatMoney(abs(value), currency, locale);
  const side = ACCOUNT_KINDS[type].side;
  if (side === 'liability') {
    if (balance === 0)
      return { text: type === 'loan' ? 'Paid off' : 'Nothing owed', tone: 'normal' };
    if (balance < 0)
      return {
        text: type === 'loan' ? `${money(balance)} left to pay` : `${money(balance)} used`,
        tone: 'owed',
      };
    return { text: `${money(balance)} in credit`, tone: 'normal' };
  }
  if (side === 'either') {
    if (balance === 0) return { text: 'Settled', tone: 'normal' };
    return balance > 0
      ? { text: `Owes you ${money(balance)}`, tone: 'owes_you' }
      : { text: `You owe ${money(balance)}`, tone: 'owed' };
  }
  return balance < 0
    ? { text: `${money(balance)} overdrawn`, tone: 'owed' }
    : { text: money(balance), tone: 'normal' };
}

/** What is left of a card's limit: the limit plus the balance, which is negative while money is owed. Never below nothing. */
export const cardAvailable = (limit: number, balance: number): number =>
  Math.max(0, limit + balance);

/** What of a card's limit is used: the owed balance, nothing for one in credit. */
export const cardUsed = (balance: number): number => Math.max(0, -balance);

/** A loan's left to pay, and what has been paid so far of the principal (never below nothing, never above it). */
export function loanProgress(principal: number, balance: number): { left: number; paid: number } {
  const left = Math.max(0, -balance);
  return { left, paid: Math.min(principal, Math.max(0, principal - left)) };
}
