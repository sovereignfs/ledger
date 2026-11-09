import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll } from '../db/exec';
import { tableNamed } from '../db/tables';
import { testTarget } from '../db/test-support';
import { ensureBook } from '../ledger/books';
import { getEntry } from '../ledger/entries';
import { seedAccount, seedIncomeSource, seedSubcategory } from '../ledger/testing';
import { createTransaction } from '../ledger/transactions';
import { setCategoryArchived } from '../budget/categories';
import {
  type NewRecurring,
  type Template,
  createRecurring,
  endRecurring,
  listRecurring,
  postDue,
  postOccurrence,
  repeatEntry,
  updateRecurring,
} from './recurring';

const { leg } = testTarget();

let t: TwoAccounts;
let adas: string;
let graces: string;
let bank: string;
let rentSub: string;
let power: string;
let pay: string;
beforeAll(async () => {
  t = await twoAccounts();
  adas = (await ensureBook(t.database, t.ada.id)).id;
  graces = (await ensureBook(t.database, t.grace.id)).id;
  bank = await seedAccount(t.database, adas, 'USD');
  rentSub = await seedSubcategory(t.database, adas);
  power = await seedSubcategory(t.database, adas);
  pay = await seedIncomeSource(t.database, adas);
});
afterAll(async () => t.close());
// Each test posts what is due in the whole book, so what an earlier test made is ended: a test sees only its own entries.
afterEach(async () => {
  for (const each of await listRecurring(t.database, t.ada.id, adas))
    if (each.endedAt === null) await endRecurring(t.database, t.ada.id, adas, each.id);
});

const expenseOf = (amount: number, sub = rentSub, over: Partial<Template> = {}): Template => ({
  type: 'expense',
  lines: [
    { account: bank, amount: -amount, currency: 'USD' },
    { subcategory: sub, amount, currency: 'USD' },
  ],
  payee: null,
  note: null,
  ...over,
});
const make = async (over: Partial<NewRecurring> & Pick<NewRecurring, 'anchor'>) => {
  const result = await createRecurring(t.database, t.ada.id, adas, {
    template: expenseOf(120_000),
    unit: 'month',
    every: 1,
    mode: 'auto',
    ...over,
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.id;
};
const posted = async (recurringId: string) =>
  dbAll<{ date: string; status: string; by: string; id: string }>(
    t.database,
    sql`SELECT date AS date, status AS status, created_by AS by, id AS id FROM ${tableNamed(t.database, 'txn')} WHERE recurring_id = ${recurringId} ORDER BY date`,
  );
const rowOf = async (id: string) =>
  (await listRecurring(t.database, t.ada.id, adas)).find((r) => r.id === id);
const AT = (iso: string) => new Date(iso);

describe(`making a recurring entry (${leg})`, () => {
  it('is made from a template and a rule, its first occurrence the anchor, and listed', async () => {
    const id = await make({
      anchor: '2026-12-01',
      template: expenseOf(120_000, rentSub, { payee: 'Landlord', note: 'rent' }),
    });
    expect(await rowOf(id)).toMatchObject({
      mode: 'auto',
      nextDate: '2026-12-01',
      endedAt: null,
      rule: { unit: 'month', every: 1, anchor: '2026-12-01', end: null },
      template: { type: 'expense', payee: 'Landlord', note: 'rent' },
    });
  });

  it('refuses, in sentences and writing nothing, a rule, a mode or a template that is not one', async () => {
    const before = (await listRecurring(t.database, t.ada.id, adas)).length;
    const refused = async (over: Partial<NewRecurring>) =>
      createRecurring(t.database, t.ada.id, adas, {
        template: expenseOf(100),
        unit: 'month',
        every: 1,
        mode: 'auto',
        anchor: '2026-12-01',
        ...over,
      });
    for (const over of [
      { every: 0 },
      { unit: 'hour' as never },
      { anchor: '2026-02-30' },
      { end: '2026-01-01' },
      { mode: 'maybe' as never },
      { template: { ...expenseOf(100), type: 'opening' as never } },
      {
        template: {
          ...expenseOf(100),
          lines: [
            { account: bank, amount: -100, currency: 'USD' },
            { subcategory: rentSub, amount: 99, currency: 'USD' },
          ],
        },
      },
    ])
      expect(await refused(over), JSON.stringify(over)).toMatchObject({
        ok: false,
        reason: 'invalid',
      });
    expect((await listRecurring(t.database, t.ada.id, adas)).length).toBe(before);
  });

  it('is made only from what is the book’s: another person’s account or subcategory is not found, and nothing is written', async () => {
    const before = (await listRecurring(t.database, t.ada.id, adas)).length;
    const hers = await seedSubcategory(t.database, graces);
    expect(
      await createRecurring(t.database, t.ada.id, adas, {
        template: expenseOf(100, hers),
        unit: 'month',
        every: 1,
        mode: 'auto',
        anchor: '2026-12-01',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(
      await createRecurring(t.database, t.grace.id, adas, {
        template: expenseOf(100),
        unit: 'month',
        every: 1,
        mode: 'auto',
        anchor: '2026-12-01',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect((await listRecurring(t.database, t.ada.id, adas)).length).toBe(before);
  });

  it('is made from an entry that was written ("Repeat…"): the entry is its anchor’s occurrence, and the next is the one after', async () => {
    const entry = await createTransaction(t.database, t.ada.id, adas, {
      type: 'expense',
      date: '2026-10-31',
      payee: 'Gym',
      note: 'membership',
      lines: expenseOf(4_000).lines,
    });
    if (!entry.ok) throw new Error('not written');
    const made = await repeatEntry(t.database, t.ada.id, adas, entry.id, {
      unit: 'month',
      every: 1,
      mode: 'auto',
    });
    if (!made.ok) throw new Error(JSON.stringify(made));
    expect(await rowOf(made.id)).toMatchObject({
      nextDate: '2026-11-30',
      template: { payee: 'Gym', note: 'membership' },
      rule: { anchor: '2026-10-31' },
    });
    expect((await posted(made.id)).map((p) => p.date)).toEqual(['2026-10-31']);
    // The entry is not posted again for its own day, and the next posts on its day.
    expect(await postDue(t.database, AT('2026-11-30T12:00:00Z'))).toMatchObject({ posted: 1 });
    expect((await posted(made.id)).map((p) => p.date)).toEqual(['2026-10-31', '2026-11-30']);
    // It repeats once: again is refused, as is an opening balance, and an entry of another person's.
    expect(
      await repeatEntry(t.database, t.ada.id, adas, entry.id, {
        unit: 'week',
        every: 1,
        mode: 'auto',
      }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    const opening = await createTransaction(t.database, t.ada.id, adas, {
      type: 'opening',
      date: '2026-01-01',
      lines: [
        { account: bank, amount: 5, currency: 'USD' },
        { equity: 'opening', amount: -5, currency: 'USD' },
      ],
    });
    if (!opening.ok) throw new Error('not written');
    expect(
      await repeatEntry(t.database, t.ada.id, adas, opening.id, {
        unit: 'month',
        every: 1,
        mode: 'auto',
      }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(
      await repeatEntry(t.database, t.grace.id, adas, entry.id, {
        unit: 'month',
        every: 1,
        mode: 'auto',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect((await getEntry(t.database, t.ada.id, adas, entry.id))?.payee?.name).toBe('Gym');
  });
});

describe(`posting what is due (${leg})`, () => {
  it('posts a monthly rent on the 1st once, even with the job run twice and from several processes at once', async () => {
    const id = await make({
      anchor: '2027-01-01',
      template: expenseOf(120_000, rentSub, { payee: 'Landlord' }),
    });
    const now = AT('2027-01-01T08:00:00Z');
    // Before the day: nothing.
    expect((await postDue(t.database, AT('2026-12-31T08:00:00Z'))).posted).toBe(0);
    expect(await posted(id)).toEqual([]);
    // On the day, run again and again and at once.
    const runs = await Promise.all([
      postDue(t.database, now),
      postDue(t.database, now),
      postDue(t.database, now),
    ]);
    await postDue(t.database, now);
    const made = await posted(id);
    expect(made.map((p) => [p.date, p.status, p.by])).toEqual([
      ['2027-01-01', 'pending', t.ada.id],
    ]);
    expect(runs.reduce((sum, run) => sum + run.posted, 0)).toBeGreaterThanOrEqual(1);
    expect((await rowOf(id))?.nextDate).toBe('2027-02-01');
    // The posting is an ordinary entry: its lines are the template's, its payee remembered.
    expect(await getEntry(t.database, t.ada.id, adas, made[0]?.id as string)).toMatchObject({
      type: 'expense',
      payee: { name: 'Landlord' },
      lines: [{ amount: -120_000 }, { amount: 120_000 }],
    });
  });

  it('posts the three occurrences a server down for three days missed, once each', async () => {
    const id = await make({
      anchor: '2027-03-01',
      unit: 'day',
      every: 1,
      template: expenseOf(500),
    });
    const now = AT('2027-03-03T10:00:00Z');
    expect(await postDue(t.database, now)).toMatchObject({ posted: 3, failed: 0 });
    expect((await posted(id)).map((p) => p.date)).toEqual([
      '2027-03-01',
      '2027-03-02',
      '2027-03-03',
    ]);
    expect(await postDue(t.database, now)).toMatchObject({ posted: 0 });
    expect((await posted(id)).length).toBe(3);
    expect((await rowOf(id))?.nextDate).toBe('2027-03-04');
    // And on the next day, the one.
    await postDue(t.database, AT('2027-03-04T00:30:00Z'));
    expect((await posted(id)).length).toBe(4);
  });

  it('leaves an entry that waits to be confirmed alone', async () => {
    const id = await make({
      anchor: '2027-04-01',
      mode: 'confirm',
      template: expenseOf(9_000, power),
    });
    await postDue(t.database, AT('2027-04-05T00:00:00Z'));
    expect(await posted(id)).toEqual([]);
    expect((await rowOf(id))?.nextDate).toBe('2027-04-01');
  });

  it('goes by the book’s own day: an entry for the 2nd is due in Kiritimati (+14) at noon UTC on the 1st, and not in a book on UTC', async () => {
    const id = await make({ anchor: '2027-05-02', template: expenseOf(700) });
    const instant = AT('2027-05-01T12:00:00Z');
    await postDue(t.database, instant);
    expect(await posted(id)).toEqual([]);
    await dbAll(
      t.database,
      sql`UPDATE ${tableNamed(t.database, 'book')} SET time_zone = 'Pacific/Kiritimati' WHERE id = ${adas} RETURNING id`,
    );
    await postDue(t.database, instant);
    expect((await posted(id)).map((p) => p.date)).toEqual(['2027-05-02']);
    await dbAll(
      t.database,
      sql`UPDATE ${tableNamed(t.database, 'book')} SET time_zone = 'UTC' WHERE id = ${adas} RETURNING id`,
    );
  });

  it('moves on past an occurrence the person skipped, or that was posted already, and posts nothing for it', async () => {
    const id = await make({
      anchor: '2027-06-01',
      unit: 'day',
      every: 1,
      template: expenseOf(300),
    });
    await dbAll(
      t.database,
      sql`INSERT INTO ${tableNamed(t.database, 'recurring_skip')} (recurring_id, occurrence_date, book_id) VALUES (${id}, '2027-06-02', ${adas}) RETURNING recurring_id`,
    );
    const result = await postDue(t.database, AT('2027-06-03T00:00:00Z'));
    expect(result).toMatchObject({ posted: 2, passed: 1 });
    expect((await posted(id)).map((p) => p.date)).toEqual(['2027-06-01', '2027-06-03']);
  });

  it('ends an entry with its last occurrence, which is the end day itself', async () => {
    const id = await make({
      anchor: '2027-07-01',
      end: '2027-07-03',
      unit: 'day',
      every: 1,
      template: expenseOf(100),
    });
    expect(await postDue(t.database, AT('2027-07-10T00:00:00Z'))).toMatchObject({ posted: 3 });
    expect(await rowOf(id)).toMatchObject({ nextDate: null });
    expect((await rowOf(id))?.endedAt).not.toBeNull();
    expect(await postDue(t.database, AT('2027-07-20T00:00:00Z'))).toMatchObject({ posted: 0 });
    expect((await posted(id)).length).toBe(3);
  });

  it('is never wedged by an entry that no longer makes a valid entry: it stays due and others post, and it posts once it is mended', async () => {
    const stuckSub = await seedSubcategory(t.database, adas);
    const stuck = await make({ anchor: '2027-08-01', template: expenseOf(100, stuckSub) });
    const fine = await make({ anchor: '2027-08-01', template: expenseOf(200) });
    await setCategoryArchived(t.database, t.ada.id, adas, 'subcategory', stuckSub, true);
    const now = AT('2027-08-01T12:00:00Z');
    expect(await postDue(t.database, now)).toMatchObject({ failed: 1 });
    expect((await posted(fine)).length).toBe(1);
    expect(await posted(stuck)).toEqual([]);
    expect((await rowOf(stuck))?.nextDate).toBe('2027-08-01');
    await setCategoryArchived(t.database, t.ada.id, adas, 'subcategory', stuckSub, false);
    expect(await postDue(t.database, now)).toMatchObject({ posted: 1, failed: 0 });
    expect((await posted(stuck)).map((p) => p.date)).toEqual(['2027-08-01']);
  });

  it('posts an income and a transfer as it does an expense, and keeps the one posting per occurrence in the table itself', async () => {
    const savings = await seedAccount(t.database, adas, 'USD', 'savings');
    const income = await make({
      anchor: '2027-09-01',
      template: {
        type: 'income',
        lines: [
          { account: bank, amount: 5_000, currency: 'USD' },
          { incomeSource: pay, amount: -5_000, currency: 'USD' },
        ],
        payee: 'Employer',
        note: null,
      },
    });
    const transfer = await make({
      anchor: '2027-09-01',
      template: {
        type: 'transfer',
        lines: [
          { account: bank, amount: -1_000, currency: 'USD' },
          { account: savings, amount: 1_000, currency: 'USD' },
        ],
        payee: null,
        note: null,
      },
    });
    await postDue(t.database, AT('2027-09-01T12:00:00Z'));
    expect((await posted(income)).length).toBe(1);
    expect((await posted(transfer)).length).toBe(1);
    // The table's unique key is the backstop: the same occurrence cannot be written twice by any path.
    await expect(
      createTransaction(t.database, t.ada.id, adas, {
        type: 'expense',
        date: '2027-09-01',
        lines: expenseOf(1).lines,
        recurring: { id: income, occurrenceDate: '2027-09-01' },
      }),
    ).rejects.toThrow();
    expect((await posted(income)).length).toBe(1);
  });
});

describe(`changing what is to come (${leg})`, () => {
  it('changes the mode, the end, how often (from the next occurrence) and the template, and no posting already made', async () => {
    const id = await make({ anchor: '2027-10-01', template: expenseOf(1_000) });
    await postDue(t.database, AT('2027-10-01T12:00:00Z'));
    const [first] = await posted(id);
    expect(
      await updateRecurring(t.database, t.ada.id, adas, id, {
        mode: 'confirm',
        template: expenseOf(2_000),
      }),
    ).toEqual({ ok: true, id });
    expect(await rowOf(id)).toMatchObject({
      mode: 'confirm',
      template: { lines: [{ amount: -2_000 }, { amount: 2_000 }] },
    });
    expect(
      (await getEntry(t.database, t.ada.id, adas, first?.id as string))?.lines[1]?.amount,
    ).toBe(1_000);
    // Every 2 months from the next occurrence, which stays.
    expect(await updateRecurring(t.database, t.ada.id, adas, id, { every: 2 })).toEqual({
      ok: true,
      id,
    });
    expect(await rowOf(id)).toMatchObject({
      nextDate: '2027-11-01',
      rule: { every: 2, anchor: '2027-11-01' },
    });
    // An end before the next occurrence ends it.
    expect(
      await updateRecurring(t.database, t.ada.id, adas, id, { end: '2027-10-15' }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await updateRecurring(t.database, t.ada.id, adas, id, { end: '2027-11-01' })).toEqual({
      ok: true,
      id,
    });
    expect(await updateRecurring(t.database, t.ada.id, adas, id, { mode: 'auto' })).toEqual({
      ok: true,
      id,
    });
    await postDue(t.database, AT('2027-11-01T12:00:00Z'));
    expect((await rowOf(id))?.nextDate).toBeNull();
    expect((await rowOf(id))?.endedAt).not.toBeNull();
  });

  it('refuses a change that is not one, in a sentence, and changes nothing', async () => {
    const id = await make({ anchor: '2027-12-01', template: expenseOf(1_000) });
    const before = JSON.stringify(await rowOf(id));
    expect(
      await updateRecurring(t.database, t.ada.id, adas, id, { mode: 'sometimes' as never }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await updateRecurring(t.database, t.ada.id, adas, id, { every: 0 })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(
      await updateRecurring(t.database, t.ada.id, adas, id, {
        template: { ...expenseOf(100), lines: [{ account: bank, amount: -100, currency: 'USD' }] },
      }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(
      await updateRecurring(t.database, t.ada.id, adas, id, {
        template: expenseOf(100, await seedSubcategory(t.database, graces)),
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(JSON.stringify(await rowOf(id))).toBe(before);
  });

  it('is ended, and nothing more is posted; what was posted stays, and ending again changes nothing', async () => {
    const id = await make({
      anchor: '2028-01-01',
      unit: 'day',
      every: 1,
      template: expenseOf(100),
    });
    await postDue(t.database, AT('2028-01-02T12:00:00Z'));
    expect((await posted(id)).length).toBe(2);
    expect(await endRecurring(t.database, t.ada.id, adas, id)).toBe(true);
    expect(await postDue(t.database, AT('2028-01-10T12:00:00Z'))).toMatchObject({ posted: 0 });
    expect((await posted(id)).length).toBe(2);
    expect(await endRecurring(t.database, t.ada.id, adas, id)).toBe(true);
    expect(await postOccurrence(t.database, t.ada.id, adas, id, '2030-01-01')).toEqual({
      status: 'none',
    });
  });
});

describe(`another person’s recurring entries (${leg})`, () => {
  it('are not theirs: nothing is listed, changed, ended or posted, and what they ask for reads as not there', async () => {
    const id = await make({ anchor: '2028-02-01', template: expenseOf(321) });
    const before = JSON.stringify(await rowOf(id));
    expect(await listRecurring(t.database, t.grace.id, adas)).toEqual([]);
    expect(await updateRecurring(t.database, t.grace.id, adas, id, { mode: 'confirm' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await updateRecurring(t.database, t.grace.id, graces, id, { mode: 'confirm' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await endRecurring(t.database, t.grace.id, adas, id)).toBe(false);
    expect(await postOccurrence(t.database, t.grace.id, adas, id, '2030-01-01')).toEqual({
      status: 'none',
    });
    expect(await postOccurrence(t.database, t.grace.id, graces, id, '2030-01-01')).toEqual({
      status: 'none',
    });
    expect(JSON.stringify(await rowOf(id))).toBe(before);
    expect(await posted(id)).toEqual([]);
  });
});
