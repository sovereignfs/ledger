import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll, dbGet } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { type Book, ensureBook, findBook } from '../ledger/books';
import { BOOK_TABLES } from '../ledger/tables';
import { setReviewed } from '../reports/review';
import { seedBook } from '../seed/seed';
import { type ExportFile, type Row, TABLES, VERSION, exportBook } from './format';
import { importBook } from './import';
import { TEMPLATE_REFS, templateLines } from './validate';

const { leg } = testTarget();
const NOW = new Date('2026-11-09T12:00:00Z');

/**
 * The file with every id made anonymous: **each row is what it says and what it points at**, a row's hash being its own columns with each reference replaced by the hash of the row
 * it points at (the rows form no cycle). Two files with the same hashes are the same book but for ids; `exportedAt` is time and is not compared.
 */
function canonical(file: ExportFile): {
  book: ExportFile['book'];
  tables: Record<string, string[]>;
} {
  const byId = new Map<string, Row>();
  for (const spec of TABLES)
    if (spec.id)
      for (const row of file.tables[spec.table] ?? [])
        byId.set(`${spec.table}:${row[spec.id]}`, row);
  const memo = new Map<Row, string>();
  const hash = (table: string, row: Row): string => {
    const known = memo.get(row);
    if (known) return known;
    const spec = TABLES.find((each) => each.table === table) as (typeof TABLES)[number];
    const parts: unknown[] = [table];
    const refOf = (target: string, id: unknown) => {
      const found = id === null ? undefined : byId.get(`${target}:${id}`);
      return found ? hash(target, found) : null;
    };
    for (const [name, value] of Object.entries(row)) {
      if (name === spec.id) continue;
      if (spec.refs[name]) parts.push([name, refOf(spec.refs[name] as string, value)]);
      else if (spec.poly && name === spec.poly.column)
        parts.push([name, refOf(spec.poly.targets[String(row[spec.poly.kind])] as string, value)]);
      else if (spec.template && name === spec.template) {
        const template = JSON.parse(String(value)) as { lines: Record<string, unknown>[] };
        for (const line of template.lines)
          for (const [key, target] of Object.entries(TEMPLATE_REFS))
            if (line[key] !== undefined) line[key] = refOf(target, line[key]);
        parts.push([name, template]);
      } else parts.push([name, value]);
    }
    const out = createHash('sha1').update(JSON.stringify(parts)).digest('hex');
    memo.set(row, out);
    return out;
  };
  const tables: Record<string, string[]> = {};
  for (const spec of TABLES)
    tables[spec.table] = (file.tables[spec.table] ?? []).map((row) => hash(spec.table, row)).sort();
  return { book: file.book, tables };
}

let t: TwoAccounts;
let adas: Book;
let graces: Book;
let file: ExportFile;
let text: string;
beforeAll(async () => {
  t = await twoAccounts();
  await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  adas = (await findBook(t.database, t.ada.id)) as Book;
  graces = (await findBook(t.database, t.grace.id)) as Book;
  await seedBook(t.database, t.ada.id, adas.id, NOW);
  // A month reviewed, which the seed has none of, so that the table is in the file with something in it.
  await setReviewed(t.database, t.ada.id, adas.id, '2026-10', true, '2026-11-09', NOW.getTime());
  file = (await exportBook(t.database, t.ada.id, adas.id, NOW.getTime())) as ExportFile;
  text = JSON.stringify(file);
}, 180_000);
afterAll(async () => t.close());

const count = async (table: string, bookId: string) =>
  Number(
    (
      await dbGet<{ n: number | string }>(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${tableNamed(t.database, table)} WHERE book_id = ${bookId}`,
      )
    )?.n,
  );
const emptyExcept = async (bookId: string) => {
  for (const table of BOOK_TABLES)
    if (table !== 'book_currency') expect(await count(table, bookId), table).toBe(0);
};
/** A row of a table of a file being changed by a test: the file is made of what this was given, so the row is there. */
const rowOf = (c: { tables: unknown }, table: string, at: number): Record<string, unknown> =>
  ((c.tables as Record<string, Record<string, unknown>[]>)[table] as Record<string, unknown>[])[
    at
  ] as Record<string, unknown>;
const refused = (result: Awaited<ReturnType<typeof importBook>>) =>
  result as Extract<typeof result, { ok: false; reason: 'invalid' }>;

describe(`a file that is not one writes nothing (${leg})`, () => {
  it('is refused, in sentences, for what is not JSON, not a Ledger file, not a version this reads, or not whole', async () => {
    const bad = async (body: string) => importBook(t.database, t.grace.id, graces.id, body);
    expect(refused(await bad('not json')).problems[0]).toContain('not JSON');
    expect(refused(await bad('{}')).problems[0]).toContain('not a Ledger file');
    expect(refused(await bad(JSON.stringify({ ...file, format: 'other' }))).problems[0]).toContain(
      'not a Ledger file',
    );
    const newer = refused(await bad(JSON.stringify({ ...file, version: VERSION + 1 })));
    expect(newer.problems[0]).toContain('newer version of Ledger');
    expect(newer.problems[0]).toContain(`version ${VERSION + 1}`);
    expect(refused(await bad(JSON.stringify({ ...file, version: 'one' }))).problems[0]).toContain(
      'no version',
    );
    const dropped = {
      ...file,
      tables: Object.fromEntries(
        Object.entries(file.tables).filter(([name]) => name !== 'txn_line'),
      ),
    };
    expect(refused(await bad(JSON.stringify(dropped))).problems[0]).toContain('txn_line');
    expect(
      refused(await bad(JSON.stringify({ ...file, tables: { ...file.tables, mystery: [] } })))
        .problems[0],
    ).toContain('mystery');
    await emptyExcept(graces.id);
  });

  it('is refused for a row with a column too many or too few, a value of the wrong kind, an id twice, and a reference to nothing', async () => {
    const edit = (change: (copy: ExportFile) => void) => {
      const copy = JSON.parse(text) as ExportFile & {
        tables: Record<string, Record<string, unknown>[]>;
      };
      change(copy as never);
      return JSON.stringify(copy);
    };
    const run = async (body: string) =>
      refused(await importBook(t.database, t.grace.id, graces.id, body));
    expect(
      (
        await run(
          edit((c) => {
            rowOf(c, 'txn', 0).extra = 1;
          }),
        )
      ).problems[0],
    ).toContain('does not have the columns');
    expect(
      (
        await run(
          edit((c) => {
            delete rowOf(c, 'txn', 0).note;
          }),
        )
      ).problems[0],
    ).toContain('does not have the columns');
    expect(
      (
        await run(
          edit((c) => {
            rowOf(c, 'txn_line', 0).amount = 1.5;
          }),
        )
      ).problems[0],
    ).toContain('not of its kind');
    expect(
      (
        await run(
          edit((c) => {
            rowOf(c, 'txn_line', 0).amount = '5';
          }),
        )
      ).problems[0],
    ).toContain('not of its kind');
    expect(
      (
        await run(
          edit((c) => {
            rowOf(c, 'money_account', 1).id = rowOf(c, 'money_account', 0).id;
          }),
        )
      ).problems[0],
    ).toContain('another row');
    expect(
      (
        await run(
          edit((c) => {
            rowOf(c, 'txn_line', 0).txn_id = 'nope';
          }),
        )
      ).problems[0],
    ).toContain('not in the file');
    expect(
      (
        await run(
          edit((c) => {
            rowOf(c, 'budget_amount', 0).target_kind = 'nothing';
          }),
        )
      ).problems[0],
    ).toContain('not one there is');
    expect(
      (
        await run(
          edit((c) => {
            rowOf(c, 'recurring', 0).template = 'nope';
          }),
        )
      ).problems[0],
    ).toContain('not one');
    expect(
      (
        await run(
          edit((c) => {
            const row = rowOf(c, 'recurring', 0);
            const t2 = JSON.parse(String(row.template));
            t2.lines[0].account = 'ghost';
            row.template = JSON.stringify(t2);
          }),
        )
      ).problems[0],
    ).toContain('template points at');
    expect(
      (
        await run(
          edit((c) => {
            (c.book as { timeZone: string }).timeZone = 'Mars/Olympus';
          }),
        )
      ).problems[0],
    ).toContain('time zone');
    await emptyExcept(graces.id);
  });

  it('is undone whole when the entries in it do not add up, which is checked after the write', async () => {
    const tampered = JSON.parse(text) as ExportFile & {
      tables: Record<string, Record<string, unknown>[]>;
    };
    const line = rowOf(tampered, 'txn_line', 0);
    line.amount = (line.amount as number) + 7;
    const result = refused(
      await importBook(t.database, t.grace.id, graces.id, JSON.stringify(tampered)),
    );
    expect(result.problems[0]).toContain('do not add up');
    await emptyExcept(graces.id);
  });

  it('is refused into a book that has anything in it, which is left as it was', async () => {
    const before = await count('txn', adas.id);
    expect(await importBook(t.database, t.ada.id, adas.id, text)).toEqual({
      ok: false,
      reason: 'not_empty',
    });
    expect(await count('txn', adas.id)).toBe(before);
  });

  it('is not found for a book that is not the caller’s', async () => {
    expect(await importBook(t.database, t.ada.id, graces.id, text)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await importBook(t.database, t.grace.id, adas.id, text)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    await emptyExcept(graces.id);
  });
});

describe(`a book that goes out and comes back (${leg})`, () => {
  it('is imported once even when two imports are made at once, by the one that finds the book empty', async () => {
    const results = await Promise.all([
      importBook(t.database, t.grace.id, graces.id, text),
      importBook(t.database, t.grace.id, graces.id, text),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === 'not_empty')).toHaveLength(1);
    expect(await count('txn', graces.id)).toBe(file.tables.txn?.length);
  }, 120_000);

  it('gives, exported again from the second account, a file equal to the first but for ids and times', async () => {
    const again = (await exportBook(
      t.database,
      t.grace.id,
      graces.id,
      NOW.getTime(),
    )) as ExportFile;
    expect(canonical(again)).toEqual(canonical(file));
    for (const table of BOOK_TABLES)
      expect(again.tables[table]?.length, table).toBe(file.tables[table]?.length);
    expect(again.book).toEqual(file.book);
    expect(file.tables.month_review?.length).toBe(1);
  });

  it('makes every id again, and points the new rows at the new ids, in the rows and in a template', async () => {
    const again = (await exportBook(
      t.database,
      t.grace.id,
      graces.id,
      NOW.getTime(),
    )) as ExportFile;
    for (const spec of TABLES) {
      if (!spec.id) continue;
      const old = new Set((file.tables[spec.table] ?? []).map((row) => row[spec.id as string]));
      for (const row of again.tables[spec.table] ?? [])
        expect(old.has(row[spec.id]), spec.table).toBe(false);
    }
    const accountIds = new Set(again.tables.money_account?.map((row) => row.id));
    for (const row of again.tables.recurring ?? [])
      for (const line of templateLines(row.template) ?? [])
        if (line.account !== undefined) expect(accountIds.has(line.account as string)).toBe(true);
    // The imported book is the importer's: the entries say who made them.
    const made = await dbAll<{ by: string }>(
      t.database,
      sql`SELECT DISTINCT created_by AS by FROM ${tableNamed(t.database, 'txn')} WHERE book_id = ${graces.id}`,
    );
    expect(made).toEqual([{ by: t.grace.id }]);
    const reviewed = await dbAll<{ by: string }>(
      t.database,
      sql`SELECT DISTINCT reviewed_by AS by FROM ${tableNamed(t.database, 'month_review')} WHERE book_id = ${graces.id}`,
    );
    expect(reviewed.every((row) => row.by === t.grace.id)).toBe(true);
    // And the book's settings came with it.
    expect(await findBook(t.database, t.grace.id)).toMatchObject({
      baseCurrency: 'USD',
      timeZone: 'UTC',
      recap: true,
    });
    expect(((await findBook(t.database, t.grace.id)) as Book).setupDoneAt).not.toBeNull();
  });
});
