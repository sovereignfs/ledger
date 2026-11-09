import { type Column, sql } from 'drizzle-orm';
import { inBook } from '../access/book';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import { tableNamed } from '../db/tables';
import { type Book, findBook } from '../ledger/books';
import { findViolations } from '../ledger/invariants';
import { BOOK_TABLES } from '../ledger/tables';
import { type ExportFile, type Row, TABLES, type TableSpec, fileColumns } from './format';
import { TEMPLATE_REFS, parseExport } from './validate';

/**
 * Importing a file (DESIGN.md §16): **into an empty book only** (a new person's, or one emptied), the file **read whole first** (`validate.ts`), then written in **one
 * transaction**, so that a file that fails anywhere writes nothing. **Ids are made again** and every reference is mapped to the new id of what it pointed at, in the
 * rows and in a recurring entry's template, so what pointed at each other still does and nothing of the file's ids is left in the book. The people who made or reviewed
 * rows are the importer. The book is **locked first** (its row is written), so two imports at once cannot both find it empty; and the lines of every entry are
 * checked to add up after the write, a backstop that undoes it all.
 */
export type ImportResult =
  | { readonly ok: true; readonly rows: number }
  | { readonly ok: false; readonly reason: 'invalid'; readonly problems: readonly string[] }
  | { readonly ok: false; readonly reason: 'not_empty' }
  | { readonly ok: false; readonly reason: 'not_found' };

/** Thrown inside the transaction to undo it with an answer. */
class Undo extends Error {
  constructor(readonly result: Extract<ImportResult, { ok: false }>) {
    super('undone');
  }
}

const CHUNK = 40;

/** The tables that may have rows in a book that is empty: the currencies a setup step added are not something to refuse for. */
const MAY_HAVE_ROWS = ['book_currency'];

export async function importBook(
  database: Database,
  accountId: string,
  bookId: string,
  text: string,
  now: number = Date.now(),
): Promise<ImportResult> {
  const parsed = parseExport(text);
  if (!parsed.ok) return { ok: false, reason: 'invalid', problems: parsed.problems };
  const { file } = parsed;
  try {
    return await transaction(database, async (tx) => {
      const book = await findBook(tx, accountId);
      if (!book || book.id !== bookId) throw new Undo({ ok: false, reason: 'not_found' });
      // The lock: the book's row is written, so a second import waits here and then finds what the first wrote.
      const locked = await dbAll<{ id: string }>(
        tx,
        sql`UPDATE ${tableNamed(tx, 'book')} SET updated_at = ${now}
             WHERE id = ${bookId} AND ${inBook(tx, sql`${bookId}`, accountId)} RETURNING id`,
      );
      if (locked.length === 0) throw new Undo({ ok: false, reason: 'not_found' });
      for (const name of BOOK_TABLES) {
        if (MAY_HAVE_ROWS.includes(name)) continue;
        const there = await dbGet<{ n: number | string }>(
          tx,
          sql`SELECT COUNT(*) AS n FROM ${tableNamed(tx, name)} WHERE book_id = ${bookId}`,
        );
        if (Number(there?.n) > 0) throw new Undo({ ok: false, reason: 'not_empty' });
      }
      const rows = await write(tx, accountId, book, file, now);
      const broken = await findViolations(tx, bookId);
      if (broken.length > 0)
        throw new Undo({
          ok: false,
          reason: 'invalid',
          problems: [
            `The entries in this file do not add up (${broken.length} of them), so none of it was imported.`,
          ],
        });
      return { ok: true as const, rows };
    });
  } catch (error) {
    if (error instanceof Undo) return error.result;
    throw error;
  }
}

/** Writes the book's settings and every table, in the order parents first, with new ids. Returns how many rows were written. */
async function write(
  tx: Database,
  accountId: string,
  book: Book,
  file: ExportFile,
  now: number,
): Promise<number> {
  // The new id of each row of the file, by table.
  const made = new Map<string, Map<string, string>>(TABLES.map((spec) => [spec.table, new Map()]));
  for (const spec of TABLES)
    if (spec.id)
      for (const row of file.tables[spec.table] ?? [])
        made.get(spec.table)?.set(String(row[spec.id]), crypto.randomUUID());
  const mapped = (table: string, old: unknown): string | null =>
    old === null || old === undefined ? null : (made.get(table)?.get(String(old)) ?? null);

  const settings = file.book;
  await dbAll(
    tx,
    sql`UPDATE ${tableNamed(tx, 'book')}
           SET name = ${settings.name.trim()}, base_currency = ${settings.baseCurrency}, time_zone = ${settings.timeZone},
               first_day_of_week = ${settings.firstDayOfWeek}, locale = ${settings.locale}, recap = ${settings.recap},
               setup_done_at = ${settings.setupDoneAt}, updated_at = ${now}
         WHERE id = ${book.id} AND ${inBook(tx, sql`${book.id}`, accountId)} RETURNING id`,
  );

  let total = 0;
  for (const spec of TABLES) {
    const rows = (file.tables[spec.table] ?? []) as readonly Row[];
    if (rows.length === 0) continue;
    const columns = fileColumns(tx, spec);
    const people = spec.person ?? [];
    const names = [...columns.map((column) => column.name), 'book_id', ...people];
    const table = tableNamed(tx, spec.table);
    for (let from = 0; from < rows.length; from += CHUNK) {
      const chunk = rows.slice(from, from + CHUNK).map((row) => remake(spec, columns, row, mapped));
      const values = chunk.map(
        (cells) =>
          sql`(${sql.join(
            [...cells, book.id, ...people.map(() => accountId)].map((cell) => sql`${cell}`),
            sql`, `,
          )})`,
      );
      await dbAll(
        tx,
        sql`INSERT INTO ${table} (${sql.join(
          names.map((name) => sql.raw(`"${name}"`)),
          sql`, `,
        )})
            VALUES ${sql.join(values, sql`, `)}
            ${spec.table === 'book_currency' ? sql`ON CONFLICT (book_id, code) DO NOTHING` : sql``}
            RETURNING 1 AS ok`,
      );
    }
    total += rows.length;
  }
  return total;
}

/** A row of the file with its own id new and every reference to the new id of what it points at. */
function remake(
  spec: TableSpec,
  columns: readonly Column[],
  row: Row,
  mapped: (table: string, old: unknown) => string | null,
): (string | number | boolean | null)[] {
  return columns.map((column) => {
    const name = column.name;
    const cell = row[name] as string | number | boolean | null;
    if (name === spec.id) return mapped(spec.table, cell);
    const target = spec.refs[name];
    if (target !== undefined) return mapped(target, cell);
    if (spec.poly && name === spec.poly.column)
      return mapped(spec.poly.targets[String(row[spec.poly.kind])] as string, cell);
    if (spec.template && name === spec.template) return remakeTemplate(String(cell), mapped);
    return cell;
  });
}

/** A template with its lines' accounts, subcategories and income sources made new. */
function remakeTemplate(
  text: string,
  mapped: (table: string, old: unknown) => string | null,
): string {
  const value = JSON.parse(text) as { lines: Record<string, unknown>[] };
  for (const line of value.lines)
    for (const [key, target] of Object.entries(TEMPLATE_REFS))
      if (line[key] !== undefined) line[key] = mapped(target, line[key]);
  return JSON.stringify(value);
}
