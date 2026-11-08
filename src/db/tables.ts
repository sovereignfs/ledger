import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Database } from './client';
import * as postgresSchema from './schema/postgres';
import * as sqliteSchema from './schema/sqlite';

/** The table of the app's schema (or better-auth's) with a name, for the dialect of `database`: what code that works from a list of names needs. */
export function tableNamed(database: Database, name: string): SQLiteTable | PgTable {
  const schema = database.dialect === 'postgres' ? postgresSchema : sqliteSchema;
  for (const value of Object.values(schema)) {
    if (
      (is(value, PgTable) || is(value, SQLiteTable)) &&
      getTableName(value as PgTable | SQLiteTable) === name
    )
      return value as PgTable | SQLiteTable;
  }
  throw new Error(`no table named ${name}`);
}
