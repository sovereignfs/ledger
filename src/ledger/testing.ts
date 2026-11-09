import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';

/**
 * Rows for tests of what points at them, made by hand until the tasks that make them (4.1, 5.1, 5.3) have a way to: an account, a category with a subcategory,
 * an income source. Tests only; nothing imports this but a test.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

const NOW = 1_800_000_000_000;

export async function seedAccount(
  database: Database,
  bookId: string,
  currency: string,
  type = 'bank',
  name = 'Account',
): Promise<string> {
  const id = crypto.randomUUID();
  await dbAll(
    database,
    sql`INSERT INTO ${schema(database).moneyAccount} (id, book_id, type, name, currency, position, created_at, updated_at)
        VALUES (${id}, ${bookId}, ${type}, ${name}, ${currency}, 0, ${NOW}, ${NOW}) RETURNING id`,
  );
  return id;
}

export async function seedSubcategory(
  database: Database,
  bookId: string,
  currency = 'USD',
): Promise<string> {
  const categoryId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const s = schema(database);
  await dbAll(
    database,
    sql`INSERT INTO ${s.category} (id, book_id, name, currency, position, created_at)
        VALUES (${categoryId}, ${bookId}, 'Category', ${currency}, 0, ${NOW}) RETURNING id`,
  );
  await dbAll(
    database,
    sql`INSERT INTO ${s.subcategory} (id, book_id, category_id, name, budget_source, position, created_at)
        VALUES (${id}, ${bookId}, ${categoryId}, 'Subcategory', 'manual', 0, ${NOW}) RETURNING id`,
  );
  return id;
}

export async function seedIncomeSource(
  database: Database,
  bookId: string,
  currency = 'USD',
): Promise<string> {
  const id = crypto.randomUUID();
  await dbAll(
    database,
    sql`INSERT INTO ${schema(database).incomeSource} (id, book_id, name, kind, currency, created_at)
        VALUES (${id}, ${bookId}, 'Salary', 'primary', ${currency}, ${NOW}) RETURNING id`,
  );
  return id;
}
