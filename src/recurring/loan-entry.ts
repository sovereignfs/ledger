import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { balanceOf } from '../ledger/balances';
import type { TxnInput } from '../ledger/validate';
import { daysBetween, splitInstalment } from './loan-split';

/**
 * The entry a loan's instalment makes on a day (DESIGN.md §8.3). The recurring entry stores only who pays and the loan; **the split is worked out when the
 * instalment is posted**, from what is left on the loan that day (its balance, derived) and the days since the last instalment or the loan's start, so an
 * instalment deleted or an extra payment made is accounted for in the next. With interest it is an expense of three lines (the account that pays, the loan
 * and the loan's interest subcategory); with none it is a transfer to the loan.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export type LoanEntry =
  | { readonly kind: 'paid_off' }
  | { readonly kind: 'entry'; readonly entry: TxnInput; readonly last: boolean }
  | { readonly kind: 'problem'; readonly problems: readonly string[] };

export async function loanEntry(
  tx: Database,
  accountId: string,
  bookId: string,
  input: {
    recurringId: string;
    loanAccountId: string;
    payerAccountId: string;
    date: string;
    /** The instalment to pay in place of the loan's own: what a person corrected it to when confirming. */
    instalment?: number;
  },
): Promise<LoanEntry> {
  const s = schema(tx);
  const loan = await dbGet<{
    lender: string;
    startDate: string;
    instalment: number | string;
    yearlyRate: string | null;
    interestSubcategoryId: string | null;
    currency: string;
  }>(
    tx,
    sql`SELECT l.lender AS lender, l.start_date AS "startDate", l.instalment AS instalment, l.yearly_rate AS "yearlyRate",
               l.interest_subcategory_id AS "interestSubcategoryId", a.currency AS currency
          FROM ${s.loan} l JOIN ${s.moneyAccount} a ON a.id = l.account_id AND a.book_id = l.book_id
         WHERE l.account_id = ${input.loanAccountId} AND l.book_id = ${bookId} AND ${inBook(tx, sql`l.book_id`, accountId)}`,
  );
  if (!loan) return { kind: 'problem', problems: ['The loan is not there.'] };
  const owed = -(await balanceOf(tx, accountId, bookId, input.loanAccountId, input.date));
  const last = await dbGet<{ date: string | null }>(
    tx,
    sql`SELECT MAX(t.date) AS date FROM ${s.txn} t
         WHERE t.book_id = ${bookId} AND t.recurring_id = ${input.recurringId} AND t.date < ${input.date}`,
  );
  const from = last?.date ?? loan.startDate;
  const split = splitInstalment({
    owed,
    instalment: input.instalment ?? Number(loan.instalment),
    yearlyRate: loan.yearlyRate,
    days: daysBetween(from, input.date),
  });
  if (!split) return { kind: 'paid_off' };
  const { currency } = loan;
  const paying = { account: input.payerAccountId, amount: -split.total, currency };
  if (split.interest === 0)
    return {
      kind: 'entry',
      last: split.last,
      entry: {
        type: 'transfer',
        date: input.date,
        lines: [paying, { account: input.loanAccountId, amount: split.total, currency }],
        note: null,
        payee: loan.lender,
      },
    };
  if (!loan.interestSubcategoryId)
    return { kind: 'problem', problems: ['This loan has no subcategory for its interest.'] };
  return {
    kind: 'entry',
    last: split.last,
    entry: {
      type: 'expense',
      date: input.date,
      lines: [
        paying,
        ...(split.principal > 0
          ? [{ account: input.loanAccountId, amount: split.principal, currency }]
          : []),
        { subcategory: loan.interestSubcategoryId, amount: split.interest, currency },
      ],
      note: null,
      payee: loan.lender,
    },
  };
}
