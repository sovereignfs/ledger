import { sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbGet } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';

/** Whether an account's book has the recap on (`book.recap`, DESIGN.md §11.5): the one setting that says whether the monthly email is wanted. A book that is not theirs is no. */
export async function bookRecapOn(database: Database, accountId: string): Promise<boolean> {
  const s = database.dialect === 'postgres' ? postgresSchema : sqliteSchema;
  const row = await dbGet<{ recap: number | boolean }>(
    database,
    sql`SELECT b.recap AS recap FROM ${s.book} b
         WHERE EXISTS (SELECT 1 FROM ${s.bookMember} x WHERE x.book_id = b.id AND x.account_id = ${accountId}) AND ${inBook(database, sql`b.id`, accountId)}
         ORDER BY b.created_at LIMIT 1`,
  );
  return row !== undefined && Boolean(row.recap);
}
