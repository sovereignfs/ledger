import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import type { EntryFilter } from '../transactions/filter';
import { ensureBook } from './books';
import { type ListedEntry, listEntries } from './entry-list';
import { seedAccount, seedIncomeSource } from './testing';
import { createTransaction } from './transactions';
import type { TxnInput } from './validate';

const { leg } = testTarget();

let t: TwoAccounts;
let book: string;
let bank: string;
let cash: string;
let groceries: string;
let dining: string;
let movies: string;
let food: string;
let fun: string;
let pay: string;
const ids: Record<string, string> = {};

/** A category and a subcategory in it, made by hand with the names a filter shows. */
async function category(bookId: string, name: string, subs: string[]) {
  const categoryId = crypto.randomUUID();
  const s = tableNamed(t.database, 'category');
  await dbAll(
    t.database,
    sql`INSERT INTO ${s} (id, book_id, name, currency, position, created_at) VALUES (${categoryId}, ${bookId}, ${name}, 'USD', 0, 1) RETURNING id`,
  );
  const out: string[] = [];
  for (const sub of subs) {
    const id = crypto.randomUUID();
    await dbAll(
      t.database,
      sql`INSERT INTO ${tableNamed(t.database, 'subcategory')} (id, book_id, category_id, name, budget_source, position, created_at) VALUES (${id}, ${bookId}, ${categoryId}, ${sub}, 'manual', 0, 1) RETURNING id`,
    );
    out.push(id);
  }
  return { categoryId, subs: out };
}

const put = async (key: string, input: TxnInput, at: number) => {
  const result = await createTransaction(t.database, t.ada.id, book, input, at);
  if (!result.ok) throw new Error(`${key}: ${JSON.stringify(result)}`);
  ids[key] = result.id;
};
const spend = (
  account: string,
  sub: string,
  amount: number,
  date: string,
  extra: Partial<TxnInput> = {},
): TxnInput => ({
  type: 'expense',
  date,
  lines: [
    { account, amount: -amount, currency: 'USD' },
    { subcategory: sub, amount, currency: 'USD' },
  ],
  ...extra,
});

beforeAll(async () => {
  t = await twoAccounts();
  book = (await ensureBook(t.database, t.ada.id)).id;
  bank = await seedAccount(t.database, book, 'USD', 'bank', 'Bank');
  cash = await seedAccount(t.database, book, 'USD', 'cash', 'Cash');
  const a = await category(book, 'Food', ['Groceries', 'Dining']);
  [groceries, dining] = a.subs as [string, string];
  food = a.categoryId;
  const b = await category(book, 'Fun', ['Movies']);
  [movies] = b.subs as [string];
  fun = b.categoryId;
  pay = await seedIncomeSource(t.database, book);
  // Oldest first, each made a moment later than the one before, so the order of the day is the order made.
  await put(
    'open',
    {
      type: 'opening',
      date: '2026-09-01',
      lines: [
        { account: bank, amount: 100000, currency: 'USD' },
        { equity: 'opening', amount: -100000, currency: 'USD' },
      ],
    },
    1,
  );
  await put(
    'g1',
    spend(bank, groceries, 2000, '2026-10-02', { payee: 'Corner Shop', note: 'weekly shop' }),
    2,
  );
  await put(
    'd1',
    spend(cash, dining, 1500, '2026-10-10', { payee: 'Pizza Place', note: '50%_off voucher' }),
    3,
  );
  await put('g2', spend(bank, groceries, 3000, '2026-10-20', { payee: 'Corner Shop' }), 4);
  await put(
    'm1',
    spend(bank, movies, 1200, '2026-11-02', { payee: 'Cinema', status: 'cleared' }),
    5,
  );
  await put(
    'inc',
    {
      type: 'income',
      date: '2026-11-03',
      payee: 'Employer',
      lines: [
        { account: bank, amount: 50000, currency: 'USD' },
        { incomeSource: pay, amount: -50000, currency: 'USD' },
      ],
    },
    6,
  );
  await put(
    'tr',
    {
      type: 'transfer',
      date: '2026-11-03',
      lines: [
        { account: bank, amount: -5000, currency: 'USD' },
        { account: cash, amount: 5000, currency: 'USD' },
      ],
    },
    7,
  );
  await put(
    'split',
    {
      type: 'expense',
      date: '2026-11-05',
      payee: 'Corner Shop',
      lines: [
        { account: bank, amount: -8420, currency: 'USD' },
        { subcategory: groceries, amount: 6100, currency: 'USD' },
        { subcategory: movies, amount: 2320, currency: 'USD' },
      ],
    },
    8,
  );
});
afterAll(async () => t.close());

const keyOf = (id: string) => Object.entries(ids).find(([, value]) => value === id)?.[0] ?? id;
const list = async (
  filter: EntryFilter = {},
  limit?: number,
  cursor?: Parameters<typeof listEntries>[4],
) => listEntries(t.database, t.ada.id, book, filter, cursor, limit);
const keys = async (filter: EntryFilter = {}) =>
  (await list(filter)).entries.map((e) => keyOf(e.id));

describe(`the list (${leg})`, () => {
  it('is every entry of the book, newest first: by date, and the later made first within a day', async () => {
    expect(await keys()).toEqual(['split', 'tr', 'inc', 'm1', 'g2', 'd1', 'g1', 'open']);
  });

  it('carries each entry’s lines with the names a row shows', async () => {
    const entry = (await list({ type: 'expense', payee: undefined, q: 'weekly' }))
      .entries[0] as ListedEntry;
    expect(entry).toMatchObject({
      type: 'expense',
      status: 'pending',
      note: 'weekly shop',
      payee: { name: 'Corner Shop' },
      balanceAfter: null,
    });
    expect(
      entry.lines.map((l) => [
        l.account?.name ?? null,
        l.subcategory?.name ?? null,
        l.subcategory?.category ?? null,
        l.amount,
      ]),
    ).toEqual([
      ['Bank', null, null, -2000],
      [null, 'Groceries', 'Food', 2000],
    ]);
    const income = (await list({ type: 'income' })).entries[0] as ListedEntry;
    expect(income.lines.map((l) => l.incomeSource?.name ?? l.account?.name)).toEqual([
      'Bank',
      'Salary',
    ]);
  });

  it('is narrowed by each filter on its own', async () => {
    expect(await keys({ account: cash })).toEqual(['tr', 'd1']);
    expect(await keys({ type: 'income' })).toEqual(['inc']);
    expect(await keys({ type: 'transfer' })).toEqual(['tr']);
    expect(await keys({ type: 'opening' })).toEqual(['open']);
    expect(await keys({ status: 'cleared' })).toEqual(['m1', 'open']);
    expect(await keys({ subcategory: groceries })).toEqual(['split', 'g2', 'g1']);
    expect(await keys({ category: food })).toEqual(['split', 'g2', 'd1', 'g1']);
    expect(await keys({ category: fun })).toEqual(['split', 'm1']);
    expect(await keys({ from: '2026-11-01' })).toEqual(['split', 'tr', 'inc', 'm1']);
    expect(await keys({ to: '2026-10-10' })).toEqual(['d1', 'g1', 'open']);
    expect(await keys({ from: '2026-10-10', to: '2026-10-20' })).toEqual(['g2', 'd1']);
    expect(await keys({ q: 'corner' })).toEqual(['split', 'g2', 'g1']);
    expect(await keys({ q: 'VOUCHER' })).toEqual(['d1']);
    expect(await keys({ q: 'zzz nothing' })).toEqual([]);
  });

  it('is narrowed by the payee, by id', async () => {
    const corner = (await list({ q: 'weekly' })).entries[0]?.payee?.id as string;
    expect(await keys({ payee: corner })).toEqual(['split', 'g2', 'g1']);
    expect(await keys({ payee: crypto.randomUUID() })).toEqual([]);
  });

  it('combines filters: each one narrows the others', async () => {
    expect(await keys({ account: bank, category: food })).toEqual(['split', 'g2', 'g1']);
    expect(await keys({ account: bank, category: food, from: '2026-10-15' })).toEqual([
      'split',
      'g2',
    ]);
    expect(await keys({ account: bank, subcategory: movies, status: 'cleared' })).toEqual(['m1']);
    expect(await keys({ account: cash, type: 'expense', q: 'pizza' })).toEqual(['d1']);
    expect(await keys({ type: 'expense', status: 'cleared', q: 'corner' })).toEqual([]);
    expect(await keys({ from: '2026-11-03', to: '2026-11-03', account: bank })).toEqual([
      'tr',
      'inc',
    ]);
    // A subcategory is narrower than its category, and wins.
    expect(await keys({ category: fun, subcategory: groceries })).toEqual(['split', 'g2', 'g1']);
  });

  it('matches text as text: a % or _ is only itself, and nothing typed is a pattern', async () => {
    expect(await keys({ q: '50%_off' })).toEqual(['d1']);
    expect(await keys({ q: '50%' })).toEqual(['d1']);
    expect(await keys({ q: '%' })).toEqual(['d1']);
    expect(await keys({ q: '_' })).toEqual(['d1']);
    expect(await keys({ q: 'c_rner' })).toEqual([]);
    expect(await keys({ q: 'c%r' })).toEqual([]);
    expect(await keys({ q: '\\' })).toEqual([]);
    expect(await keys({ q: "' OR '1'='1" })).toEqual([]);
    expect(await keys({ q: "x'; DROP TABLE txn;--" })).toEqual([]);
    expect(await keys()).toHaveLength(8);
  });

  it('is paged by date: a page, and where the next starts, with nothing missed or repeated', async () => {
    const seen: string[] = [];
    let cursor: Parameters<typeof listEntries>[4];
    let pages = 0;
    do {
      const page = await list({}, 3, cursor);
      seen.push(...page.entries.map((e) => keyOf(e.id)));
      cursor = page.next;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(['split', 'tr', 'inc', 'm1', 'g2', 'd1', 'g1', 'open']);
    // A page that is exactly full has no next.
    expect((await list({}, 8)).next).toBeUndefined();
    expect((await list({}, 7)).next).toBeDefined();
    // And paging goes through a filter too.
    const first = await list({ category: food }, 2);
    expect(first.entries.map((e) => keyOf(e.id))).toEqual(['split', 'g2']);
    expect((await list({ category: food }, 2, first.next)).entries.map((e) => keyOf(e.id))).toEqual(
      ['d1', 'g1'],
    );
  });

  it('says what the one account’s balance was after each entry, whatever else is filtered out', async () => {
    const all = (await list({ account: bank })).entries;
    expect(all.map((e) => [keyOf(e.id), e.balanceAfter])).toEqual([
      ['split', 100000 - 2000 - 3000 - 1200 + 50000 - 5000 - 8420],
      ['tr', 100000 - 2000 - 3000 - 1200 + 50000 - 5000],
      ['inc', 100000 - 2000 - 3000 - 1200 + 50000],
      ['m1', 100000 - 2000 - 3000 - 1200],
      ['g2', 100000 - 2000 - 3000],
      ['g1', 100000 - 2000],
      ['open', 100000],
    ]);
    // With the status filtered, the rows that are shown still have the account's true balance.
    const cleared = (await list({ account: bank, status: 'cleared' })).entries;
    expect(cleared.map((e) => [keyOf(e.id), e.balanceAfter])).toEqual([
      ['m1', 100000 - 2000 - 3000 - 1200],
      ['open', 100000],
    ]);
    expect((await list({ account: cash })).entries.map((e) => e.balanceAfter)).toEqual([
      5000 - 1500,
      -1500,
    ]);
    expect((await list({})).entries.every((e) => e.balanceAfter === null)).toBe(true);
  });
});

describe(`another person’s entries (${leg})`, () => {
  it('are not listed, whatever the filter, and the filter cannot reach them', async () => {
    expect((await listEntries(t.database, t.grace.id, book)).entries).toEqual([]);
    expect(
      (
        await listEntries(t.database, t.grace.id, book, {
          account: bank,
          category: food,
          q: 'corner',
        })
      ).entries,
    ).toEqual([]);
    // Her own book lists none of Ada’s, even naming Ada’s account and category.
    const hers = (await ensureBook(t.database, t.grace.id)).id;
    expect((await listEntries(t.database, t.grace.id, hers, { account: bank })).entries).toEqual(
      [],
    );
    expect((await listEntries(t.database, t.grace.id, hers, { category: food })).entries).toEqual(
      [],
    );
    expect((await listEntries(t.database, t.ada.id, hers)).entries).toEqual([]);
  });
});
