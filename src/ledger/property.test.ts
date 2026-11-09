import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { testTarget } from '../db/test-support';
import { splitMinor } from '../money/amount';
import { balancesOf } from './balances';
import { ensureBook } from './books';
import { findViolations } from './invariants';
import { seedAccount, seedIncomeSource, seedSubcategory } from './testing';
import { createTransaction, deleteTransaction, updateTransaction } from './transactions';
import type { LineInput, TxnInput } from './validate';

/**
 * **The invariant property test** (AGENTS.md, DESIGN.md §6.2, §19): a thousand random writes to one book, among them edits, deletions and refusals, with a model
 * of what the lines should be kept apart in the test and never read from the database. After the writes every balance equals the sum of its lines, on every
 * date asked, the rows themselves satisfy every invariant (`findViolations`), nothing a refusal touched has changed, and the other person's book is untouched
 * throughout. Seeded, so a failure is the same failure again.
 */
const { leg } = testTarget();
const WRITES = 1000;

let t: TwoAccounts;
let book: string;
let other: string;
beforeAll(async () => {
  t = await twoAccounts();
  book = (await ensureBook(t.database, t.ada.id)).id;
  other = (await ensureBook(t.database, t.grace.id)).id;
});
afterAll(async () => t.close());

function random(seed: number) {
  let state = seed;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  return {
    int: (to: number) => Math.floor(next() * to),
    pick: <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T,
    chance: (p: number) => next() < p,
  };
}

describe(`a thousand random writes (${leg})`, () => {
  it('leave every balance equal to its lines, every row whole, and nothing that was refused changed', async () => {
    const rng = random(20261109);
    const usd = [
      await seedAccount(t.database, book, 'USD'),
      await seedAccount(t.database, book, 'USD', 'cash'),
      await seedAccount(t.database, book, 'USD', 'savings'),
    ];
    const euro = await seedAccount(t.database, book, 'EUR');
    const loan = await seedAccount(t.database, book, 'USD', 'loan');
    const fund = await seedAccount(t.database, book, 'USD', 'investment');
    const subs = [
      await seedSubcategory(t.database, book),
      await seedSubcategory(t.database, book),
      await seedSubcategory(t.database, book),
    ];
    const sources = [
      await seedIncomeSource(t.database, book),
      await seedIncomeSource(t.database, book),
    ];
    const theirs = {
      account: await seedAccount(t.database, other, 'USD'),
      sub: await seedSubcategory(t.database, other),
    };

    // The model: what each entry's lines should be, and its date.
    const model = new Map<string, { date: string; lines: LineInput[] }>();
    const date = () =>
      `2026-${String(1 + rng.int(12)).padStart(2, '0')}-${String(1 + rng.int(28)).padStart(2, '0')}`;
    const amount = () => 1 + rng.int(500_000);

    const generate = (): TxnInput => {
      const when = date();
      const kind = rng.pick([
        'expense',
        'expense',
        'expense',
        'income',
        'transfer',
        'cross',
        'opening',
        'adjustment',
        'revaluation',
        'instalment',
      ] as const);
      switch (kind) {
        case 'expense': {
          const total = (rng.chance(0.1) ? -1 : 1) * amount();
          const parts = splitMinor(total, 1 + rng.int(4));
          return {
            type: 'expense',
            date: when,
            lines: [
              { account: rng.pick(usd), amount: -total, currency: 'USD' },
              ...parts.map((part): LineInput => ({
                subcategory: rng.pick(subs),
                amount: part,
                currency: 'USD',
              })),
            ].filter((line) => line.amount !== 0),
          };
        }
        case 'income': {
          const total = amount();
          return {
            type: 'income',
            date: when,
            lines: [
              { account: rng.pick(usd), amount: total, currency: 'USD' },
              ...splitMinor(total, 1 + rng.int(2)).map((part): LineInput => ({
                incomeSource: rng.pick(sources),
                amount: -part,
                currency: 'USD',
              })),
            ],
          };
        }
        case 'transfer': {
          const [from, to] = [usd[0] as string, rng.pick([usd[1], usd[2], loan]) as string];
          const total = amount();
          return {
            type: 'transfer',
            date: when,
            lines: [
              { account: from, amount: -total, currency: 'USD' },
              { account: to, amount: total, currency: 'USD' },
            ],
          };
        }
        case 'cross':
          return {
            type: 'transfer',
            date: when,
            lines: [
              { account: usd[0] as string, amount: -amount(), currency: 'USD' },
              { account: euro, amount: amount(), currency: 'EUR' },
            ],
          };
        case 'instalment': {
          const principal = amount();
          const interest = 1 + rng.int(5000);
          return {
            type: 'expense',
            date: when,
            lines: [
              { account: usd[0] as string, amount: -(principal + interest), currency: 'USD' },
              { account: loan, amount: principal, currency: 'USD' },
              { subcategory: rng.pick(subs), amount: interest, currency: 'USD' },
            ],
          };
        }
        case 'revaluation': {
          const delta = (rng.chance(0.5) ? -1 : 1) * amount();
          return {
            type: 'revaluation',
            date: when,
            lines: [
              { account: fund, amount: delta, currency: 'USD' },
              { equity: 'revaluation', amount: -delta, currency: 'USD' },
            ],
          };
        }
        default: {
          const delta = (rng.chance(0.3) ? -1 : 1) * amount();
          return {
            type: kind,
            date: when,
            lines: [
              { account: rng.pick(usd), amount: delta, currency: 'USD' },
              { equity: kind, amount: -delta, currency: 'USD' },
            ],
          };
        }
      }
    };

    /** A write that must be refused, whatever it is: a sum that is off, a foreign account, a subcategory that is not there. */
    const corrupt = (input: TxnInput): { input: TxnInput; refused: 'invalid' | 'not_found' } => {
      const lines = [...input.lines];
      switch (rng.int(3)) {
        case 0: {
          const first = lines[0] as LineInput;
          const last = lines[lines.length - 1] as LineInput;
          // A sum that is off by one; for the transfer of two currencies, which is not summed, both lines go the same way instead.
          const crossed = first.currency !== last.currency;
          lines[lines.length - 1] = { ...last, amount: crossed ? first.amount : last.amount + 1 };
          return { input: { ...input, lines }, refused: 'invalid' };
        }
        case 1:
          lines[0] = {
            account: theirs.account,
            amount: (lines[0] as LineInput).amount,
            currency: (lines[0] as LineInput).currency,
          };
          return {
            input: { ...input, lines },
            refused: lines[0].amount === 0 ? 'invalid' : 'not_found',
          };
        default:
          lines.push({ subcategory: theirs.sub, amount: 0, currency: 'USD' });
          return { input: { ...input, lines }, refused: 'invalid' };
      }
    };

    const expected = (asOf?: string) => {
      const sums = new Map<string, number>();
      for (const { date: when, lines } of model.values())
        if (asOf === undefined || when <= asOf)
          for (const line of lines)
            if (line.account) sums.set(line.account, (sums.get(line.account) ?? 0) + line.amount);
      return sums;
    };
    const verify = async (asOf?: string) => {
      const actual = await balancesOf(t.database, t.ada.id, book, asOf);
      const want = expected(asOf);
      for (const id of new Set([...actual.keys(), ...want.keys()]))
        expect(actual.get(id) ?? 0, `${id} as of ${asOf ?? 'always'}`).toBe(want.get(id) ?? 0);
    };

    let refusals = 0;
    for (let n = 1; n <= WRITES; n++) {
      const ids = [...model.keys()];
      const roll = rng.int(10);
      if (roll < 5 || ids.length === 0) {
        const input = generate();
        const result = await createTransaction(t.database, t.ada.id, book, input);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (result.ok) model.set(result.id, { date: input.date, lines: [...input.lines] });
      } else if (roll < 7) {
        const id = rng.pick(ids);
        const input = generate();
        const result = await updateTransaction(t.database, t.ada.id, book, id, input);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        model.set(id, { date: input.date, lines: [...input.lines] });
      } else if (roll < 8) {
        const id = rng.pick(ids);
        expect(await deleteTransaction(t.database, t.ada.id, book, id)).toBe(true);
        model.delete(id);
      } else {
        // A write that is refused: it changes nothing, whether it is a new entry or an edit of one that is there.
        const { input, refused } = corrupt(generate());
        const result =
          rng.chance(0.5) || ids.length === 0
            ? await createTransaction(t.database, t.ada.id, book, input)
            : await updateTransaction(t.database, t.ada.id, book, rng.pick(ids), input);
        expect(result.ok, JSON.stringify(result)).toBe(false);
        if (!result.ok) expect(result.reason).toBe(refused);
        refusals++;
      }
      if (n % 100 === 0) await verify();
    }

    expect(refusals).toBeGreaterThan(50);
    expect(model.size).toBeGreaterThan(50);
    await verify();
    for (const asOf of ['2026-01-15', '2026-04-01', '2026-07-31', '2026-12-31']) await verify(asOf);
    expect(await findViolations(t.database, book)).toEqual([]);
    // The other person's book was never touched.
    expect(await findViolations(t.database, other)).toEqual([]);
    expect((await balancesOf(t.database, t.grace.id, other)).size).toBe(0);
    expect((await balancesOf(t.database, t.grace.id, book)).size).toBe(0);
  }, 300_000);
});
