import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { memberTable } from '../ledger/books';

/**
 * **The permission is in the statement** (DESIGN.md §5.2, AGENTS.md): a row of a book is read or written only by a statement that carries, as a condition,
 * that the account is a member of the book the row is in. Never a check first and then a touch: between the two the answer could change, and a row the
 * check did not cover could be reached by the touch.
 *
 *   dbAll(db, sql`SELECT … FROM ${table} t WHERE ${inBook(database, sql`t.book_id`, accountId)} AND t.id = ${id}`)
 *
 * A row of another person's book is then a row that is not there: the statement matches nothing, the answer is "not found", and it is the same
 * answer as for a row that never existed, so no one learns what another person has. Anything a write points at (an account, a subcategory, a payee) is
 * held to the same condition in the same statement.
 */
export function inBook(database: Database, bookId: SQLWrapper, accountId: string): SQL {
  const member = memberTable(database);
  return sql`EXISTS (SELECT 1 FROM ${member} m WHERE m.book_id = ${bookId} AND m.account_id = ${accountId})`;
}
