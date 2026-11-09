import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { listCategories } from '../budget/categories';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { createAccount, deleteAccount } from '../ledger/accounts';
import { balanceOf } from '../ledger/balances';
import { ensureBook } from '../ledger/books';
import { getEntry } from '../ledger/entries';
import { seedAccount } from '../ledger/testing';
import { deleteTransaction } from '../ledger/transactions';
import { createInstalments } from './loan';
import { type Mode, endRecurring, listRecurring, postDue, postOccurrence } from './recurring';

const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let graces: string;
let bank: string;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  graces = (await ensureBook(t.database, t.grace.id)).id;
  bank = await seedAccount(t.database, adas, 'USD');
});
afterAll(async () => t.close());
afterEach(async () => {
  for (const each of await listRecurring(t.database, t.ada.id, adas))
    if (each.endedAt === null) await endRecurring(t.database, t.ada.id, adas, each.id);
});

const at = (iso: string) => new Date(iso);
let n = 0;
async function loan(
  over: {
    principal?: number;
    rate?: string | null;
    instalment?: number;
    start?: string;
    end?: string;
  } = {},
) {
  const principal = over.principal ?? 1_000_000;
  const made = await createAccount(t.database, t.ada.id, adas, {
    type: 'loan',
    name: `Car loan ${++n}`,
    currency: 'USD',
    opening: { amount: -principal, date: over.start ?? '2026-01-01' },
    loan: {
      lender: 'Bank of Lending',
      principal,
      startDate: over.start ?? '2026-01-01',
      endDate: over.end ?? '2031-01-01',
      instalment: over.instalment ?? 20_000,
      yearlyRate: over.rate === undefined ? '6' : over.rate,
      interestSubcategoryId: null,
    },
  });
  if (!made.ok) throw new Error(JSON.stringify(made));
  return made.id;
}
const instalments = async (
  loanId: string,
  first = '2026-02-01',
  mode: Mode = 'auto',
  from = bank,
) => {
  const made = await createInstalments(
    t.database,
    t.ada.id,
    adas,
    loanId,
    { from, firstDate: first, mode },
    Date.now(),
  );
  if (!made.ok) throw new Error(JSON.stringify(made));
  return made.id;
};
const posted = (recurringId: string) =>
  dbAll<{ id: string; date: string; type: string }>(
    t.database,
    sql`SELECT id AS id, date AS date, type AS type FROM ${tableNamed(t.database, 'txn')} WHERE recurring_id = ${recurringId} ORDER BY date`,
  );
const linesOf = async (id: string) => {
  const entry = await getEntry(t.database, t.ada.id, adas, id);
  return (entry?.lines ?? []).map((line) => [
    line.account ? 'account' : 'subcategory',
    line.amount,
  ]);
};
const owed = async (loanId: string, asOf?: string) =>
  0 - (await balanceOf(t.database, t.ada.id, adas, loanId, asOf));

describe(`a loan’s instalments (${leg})`, () => {
  it('posts 10,000 at 6% with 200 a month: the first three split to the cent, three lines each', async () => {
    const id = await loan();
    const recurring = await instalments(id);
    await postDue(t.database, at('2026-04-01T12:00:00Z'));
    const made = await posted(recurring);
    expect(made.map((m) => [m.date, m.type])).toEqual([
      ['2026-02-01', 'expense'],
      ['2026-03-01', 'expense'],
      ['2026-04-01', 'expense'],
    ]);
    // [bank down by the instalment, the loan up by the principal, the interest subcategory up by the interest]
    expect(await linesOf(made[0]?.id as string)).toEqual([
      ['account', -20_000],
      ['account', 14_904],
      ['subcategory', 5_096],
    ]);
    expect(await linesOf(made[1]?.id as string)).toEqual([
      ['account', -20_000],
      ['account', 15_466],
      ['subcategory', 4_534],
    ]);
    expect(await linesOf(made[2]?.id as string)).toEqual([
      ['account', -20_000],
      ['account', 15_059],
      ['subcategory', 4_941],
    ]);
    expect(await owed(id)).toBe(954_571);
    expect((await getEntry(t.database, t.ada.id, adas, made[0]?.id as string))?.payee?.name).toBe(
      'Bank of Lending',
    );
  });

  it('makes a Loans category and the loan’s interest subcategory once, and names it on the loan; a second loan joins the same category', async () => {
    const first = await loan();
    await instalments(first);
    const second = await loan();
    await instalments(second, '2026-02-15');
    const loans = (await listCategories(t.database, t.ada.id, adas)).filter(
      (c) => c.name === 'Loans',
    );
    expect(loans.length).toBe(1);
    const names = loans[0]?.subcategories.map((s) => s.name) ?? [];
    expect(names).toContain(`Car loan ${n - 1} interest`);
    expect(names).toContain(`Car loan ${n} interest`);
    expect(loans[0]?.currency).toBe('USD');
  });

  it('pays the loan to exactly zero: the last instalment is capped, and the entry ends with the loan', async () => {
    const id = await loan({ principal: 50_000, instalment: 20_000 });
    const recurring = await instalments(id);
    await postDue(t.database, at('2026-12-31T12:00:00Z'));
    const made = await posted(recurring);
    expect(made.length).toBe(3);
    expect(await owed(id)).toBe(0);
    const last = await linesOf(made[2]?.id as string);
    // The last is less than 20,000: what was left, and its interest.
    expect(Math.abs(last[0]?.[1] as number)).toBeLessThan(20_000);
    const row = (await listRecurring(t.database, t.ada.id, adas)).find((r) => r.id === recurring);
    expect(row).toMatchObject({ nextDate: null });
    expect(row?.endedAt).not.toBeNull();
    expect((await postDue(t.database, at('2027-06-01T00:00:00Z'))).posted).toBe(0);
  });

  it('is all principal, as a transfer to the loan, when the loan has no rate', async () => {
    const id = await loan({ rate: null, principal: 100_000, instalment: 30_000 });
    const recurring = await instalments(id);
    await postDue(t.database, at('2026-02-01T12:00:00Z'));
    const [made] = await posted(recurring);
    expect(made?.type).toBe('transfer');
    expect(await linesOf(made?.id as string)).toEqual([
      ['account', -30_000],
      ['account', 30_000],
    ]);
    expect(await owed(id)).toBe(70_000);
  });

  it('restores the loan’s balance when an instalment is deleted', async () => {
    const id = await loan();
    const recurring = await instalments(id);
    await postDue(t.database, at('2026-02-01T12:00:00Z'));
    expect(await owed(id)).toBe(985_096);
    const [made] = await posted(recurring);
    expect(await deleteTransaction(t.database, t.ada.id, adas, made?.id as string)).toBe(true);
    expect(await owed(id)).toBe(1_000_000);
  });

  it('asks first when it is set to, and posts with the amount a person corrected it to', async () => {
    const id = await loan();
    const recurring = await instalments(id, '2026-02-01', 'confirm');
    expect((await postDue(t.database, at('2026-03-15T00:00:00Z'))).posted).toBe(0);
    const row = (await listRecurring(t.database, t.ada.id, adas)).find((r) => r.id === recurring);
    const corrected = {
      ...(row?.template as NonNullable<typeof row>['template']),
      lines: [
        { account: bank, amount: -25_000, currency: 'USD' },
        { account: id, amount: 25_000, currency: 'USD' },
      ],
    };
    expect(
      await postOccurrence(t.database, t.ada.id, adas, recurring, '2026-02-01', Date.now(), {
        expect: '2026-02-01',
        template: corrected,
      }),
    ).toEqual({ status: 'posted', date: '2026-02-01' });
    const [made] = await posted(recurring);
    expect(await linesOf(made?.id as string)).toEqual([
      ['account', -25_000],
      ['account', 19_904],
      ['subcategory', 5_096],
    ]);
  });

  it('ends the entry with the instalment that pays the loan off, so nothing for it is offered afterwards', async () => {
    const id = await loan({ rate: null, principal: 20_000, instalment: 20_000 });
    const recurring = await instalments(id, '2026-02-01', 'confirm');
    expect(
      await postOccurrence(t.database, t.ada.id, adas, recurring, '2026-02-01', Date.now(), {
        expect: '2026-02-01',
      }),
    ).toEqual({ status: 'posted', date: '2026-02-01' });
    expect(await owed(id)).toBe(0);
    expect(
      (await listRecurring(t.database, t.ada.id, adas)).find((r) => r.id === recurring),
    ).toMatchObject({ nextDate: null });
  });

  it('posts nothing and ends when the loan was paid off another way', async () => {
    const id = await loan({ principal: 10_000, rate: null });
    const recurring = await instalments(id);
    const extra = await createAccount(t.database, t.ada.id, adas, {
      type: 'bank',
      name: 'Windfall',
      currency: 'USD',
    });
    expect(extra.ok).toBe(true);
    // The loan is paid off with a transfer before the first instalment.
    const { createTransaction } = await import('../ledger/transactions');
    const paid = await createTransaction(t.database, t.ada.id, adas, {
      type: 'transfer',
      date: '2026-01-15',
      lines: [
        { account: bank, amount: -10_000, currency: 'USD' },
        { account: id, amount: 10_000, currency: 'USD' },
      ],
    });
    expect(paid.ok).toBe(true);
    expect((await postDue(t.database, at('2026-02-01T12:00:00Z'))).posted).toBe(0);
    expect(await posted(recurring)).toEqual([]);
    expect(
      (await listRecurring(t.database, t.ada.id, adas)).find((r) => r.id === recurring),
    ).toMatchObject({ nextDate: null });
  });

  it('ends with a loan that is deleted before anything was posted', async () => {
    const id = await loan();
    const recurring = await instalments(id);
    // Deleting a loan needs nothing but its opening balance: the opening goes with it, and so do its instalments.
    expect(await deleteAccount(t.database, t.ada.id, adas, id)).toBe('deleted');
    const row = (await listRecurring(t.database, t.ada.id, adas)).find((r) => r.id === recurring);
    expect(row).toMatchObject({ nextDate: null });
    expect(row?.endedAt).not.toBeNull();
  });

  it('is made once for a loan, and only from the person’s own accounts', async () => {
    const id = await loan();
    await instalments(id);
    const again = await createInstalments(t.database, t.ada.id, adas, id, {
      from: bank,
      firstDate: '2026-03-01',
      mode: 'auto',
    });
    expect(again).toMatchObject({ ok: false, reason: 'invalid' });
    const other = await loan();
    const hers = await seedAccount(t.database, graces, 'USD');
    expect(
      await createInstalments(t.database, t.ada.id, adas, other, {
        from: hers,
        firstDate: '2026-03-01',
        mode: 'auto',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await createInstalments(t.database, t.grace.id, adas, other, {
        from: bank,
        firstDate: '2026-03-01',
        mode: 'auto',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await createInstalments(t.database, t.grace.id, graces, other, {
        from: hers,
        firstDate: '2026-03-01',
        mode: 'auto',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await createInstalments(t.database, t.ada.id, adas, bank, {
        from: bank,
        firstDate: '2026-03-01',
        mode: 'auto',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      (await listRecurring(t.database, t.ada.id, adas)).filter((r) => r.loanAccountId === other),
    ).toEqual([]);
    const late = await createInstalments(t.database, t.ada.id, adas, other, {
      from: bank,
      firstDate: '2040-03-01',
      mode: 'auto',
    });
    expect(late).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
