import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import { MAX_CATEGORY_NAME } from '../budget/categories';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { refusal, runWrite, type WriteResult } from '../ledger/transactions';
import { type Mode, insertRecurring } from './recurring';

/**
 * Making a loan's instalment a recurring entry (DESIGN.md §8.3): from a chosen account, from a first day and then every month, in a mode, **ending with the
 * loan's end date or when it is paid off**. It makes a *Loans* category and the loan's interest subcategory when they are not there, and names the
 * subcategory on the loan, which is where each instalment's interest is spent. All in one transaction; a loan has one set of instalments.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

const NOT_FOUND = { ok: false, reason: 'not_found' } as const;
const invalid = (...problems: string[]) => ({ ok: false, reason: 'invalid', problems }) as const;

export const LOANS_CATEGORY = 'Loans';

export async function createInstalments(
  database: Database,
  accountId: string,
  bookId: string,
  loanAccountId: string,
  input: { from: string; firstDate: string; mode: Mode },
  now: number = Date.now(),
): Promise<WriteResult> {
  return runWrite(database, async (tx) => {
    const s = schema(tx);
    const loan = await dbGet<{
      name: string;
      lender: string;
      currency: string;
      endDate: string;
      instalment: number | string;
      interestSubcategoryId: string | null;
    }>(
      tx,
      sql`SELECT a.name AS name, l.lender AS lender, a.currency AS currency, l.end_date AS "endDate", l.instalment AS instalment,
                 l.interest_subcategory_id AS "interestSubcategoryId"
            FROM ${s.moneyAccount} a JOIN ${s.loan} l ON l.account_id = a.id AND l.book_id = a.book_id
           WHERE a.id = ${loanAccountId} AND a.book_id = ${bookId} AND a.type = 'loan' AND a.archived_at IS NULL
             AND ${inBook(tx, sql`a.book_id`, accountId)}`,
    );
    if (!loan) throw refusal(NOT_FOUND);
    const already = await dbGet<{ id: string }>(
      tx,
      sql`SELECT r.id AS id FROM ${s.recurring} r
           WHERE r.book_id = ${bookId} AND r.loan_account_id = ${loanAccountId} AND r.ended_at IS NULL`,
    );
    if (already) throw refusal(invalid('This loan has its instalments already.'));

    const instalment = Number(loan.instalment);
    const id = await insertRecurring(
      tx,
      accountId,
      bookId,
      {
        // What the entry stores is who pays and what it comes to; the split is worked out when each is posted (`loan-entry.ts`).
        template: {
          type: 'transfer',
          lines: [
            { account: input.from, amount: -instalment, currency: loan.currency },
            { account: loanAccountId, amount: instalment, currency: loan.currency },
          ],
          payee: loan.lender,
          note: null,
        },
        unit: 'month',
        every: 1,
        anchor: input.firstDate,
        end: loan.endDate,
        mode: input.mode,
        loanAccountId,
      },
      now,
    );

    if (!loan.interestSubcategoryId) {
      const category =
        (
          await dbGet<{ id: string }>(
            tx,
            sql`SELECT c.id AS id FROM ${s.category} c
               WHERE c.book_id = ${bookId} AND lower(c.name) = lower(${LOANS_CATEGORY}) AND ${inBook(tx, sql`c.book_id`, accountId)}
               ORDER BY c.archived_at IS NOT NULL, c.created_at LIMIT 1`,
          )
        )?.id ?? crypto.randomUUID();
      await dbAll(
        tx,
        sql`INSERT INTO ${s.category} (id, book_id, name, currency, position, created_at)
            SELECT ${category}, b.id, ${LOANS_CATEGORY}, ${loan.currency},
                   (SELECT COALESCE(MAX(c.position), -1) + 1 FROM ${s.category} c WHERE c.book_id = b.id), ${now}
              FROM ${s.book} b
             WHERE b.id = ${bookId} AND ${inBook(tx, sql`b.id`, accountId)}
               AND NOT EXISTS (SELECT 1 FROM ${s.category} e WHERE e.id = ${category})
            RETURNING id`,
      );
      const name = `${loan.name} interest`.slice(0, MAX_CATEGORY_NAME);
      const sub =
        (
          await dbGet<{ id: string }>(
            tx,
            sql`SELECT u.id AS id FROM ${s.subcategory} u
               WHERE u.book_id = ${bookId} AND u.category_id = ${category} AND lower(u.name) = lower(${name})`,
          )
        )?.id ?? crypto.randomUUID();
      await dbAll(
        tx,
        sql`INSERT INTO ${s.subcategory} (id, book_id, category_id, name, budget_source, position, created_at)
            SELECT ${sub}, c.book_id, c.id, ${name}, 'manual',
                   (SELECT COALESCE(MAX(u.position), -1) + 1 FROM ${s.subcategory} u WHERE u.category_id = c.id AND u.book_id = c.book_id), ${now}
              FROM ${s.category} c
             WHERE c.id = ${category} AND c.book_id = ${bookId} AND ${inBook(tx, sql`c.book_id`, accountId)}
               AND NOT EXISTS (SELECT 1 FROM ${s.subcategory} e WHERE e.id = ${sub})
            RETURNING id`,
      );
      const named = await dbAll<{ id: string }>(
        tx,
        sql`UPDATE ${s.loan} SET interest_subcategory_id = ${sub}
             WHERE account_id = ${loanAccountId} AND book_id = ${bookId} AND ${inBook(tx, sql`${s.loan.bookId}`, accountId)}
             RETURNING account_id AS id`,
      );
      if (named.length === 0) throw refusal(NOT_FOUND);
    }
    return id;
  });
}
