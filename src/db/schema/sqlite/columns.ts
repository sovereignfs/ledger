import { integer, text } from 'drizzle-orm/sqlite-core';

/**
 * The column vocabulary every table is written in, so that a kind of value has one representation on both dialects (DESIGN.md §18.2).
 * `schema/postgres/columns.ts` exports the same names; the schema parity test keeps the two in step. A table names these and never a
 * dialect's own type.
 *
 * - `id`        a row's key: text, a UUID made by the server.
 * - `ref`       a reference to another table's `id`: the same text, not a key itself.
 * - `epochMs`   a point in time as milliseconds since the epoch, a JS number: no time zones, no Date parsing, the same on both dialects.
 * - `counter`   a 64-bit whole number that is a JS number: a count.
 * - `money`     an amount in a currency's minor units: a 64-bit whole number that is a JS number, which `src/money` checks is a safe integer
 *               (never a float, DESIGN.md §9.1). PostgreSQL needs `bigint`, since a 13-digit amount overflows its `integer`.
 * - `bool`      a boolean. SQLite stores 0 and 1, and reads it back as a JS boolean through the driver's mode; PostgreSQL has a boolean.
 * - `isoDate`   a calendar date as text, `YYYY-MM-DD`, in no time zone. Text compares in date order.
 * - `month`     a calendar month as text, `YYYY-MM`. Text compares in month order.
 * - `decimal`   an exchange rate or a yearly interest rate, as a decimal string: never a float, so that conversion is exact (DESIGN.md §9.3).
 * - `json`      JSON as text, for a template or a notice's details; the server reads it only where a task says so.
 */
export const id = (name: string) => text(name).primaryKey();

export const ref = (name: string) => text(name);

export const epochMs = (name: string) => integer(name, { mode: 'number' });

export const counter = (name: string) => integer(name, { mode: 'number' });

export const money = (name: string) => integer(name, { mode: 'number' });

export const bool = (name: string) => integer(name, { mode: 'boolean' });

export const isoDate = (name: string) => text(name);

export const month = (name: string) => text(name);

export const decimal = (name: string) => text(name);

export const json = (name: string) => text(name);
