import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll, dbRun } from '../db/exec';
import { testTarget } from '../db/test-support';
import { tableNamed } from '../db/tables';
import { ensureBook } from '../ledger/books';
import { addCurrency } from '../ledger/currencies';
import { JobRunner, kindOf, type RunnerDeps } from '../jobs/runner';
import { FxError } from './frankfurter';
import { fetchRatesJob } from './job';
import { currenciesInUse, fetchRates, rateOn, storeRates } from './rates';
import { startFakeFrankfurter, type FakeFrankfurter } from './testing/fake-frankfurter';

const { leg } = testTarget();

let t: TwoAccounts;
let adasBook: string;
let gracesBook: string;
let fake: FakeFrankfurter;
let defaultRates: Record<string, string>;
beforeAll(async () => {
  t = await twoAccounts();
  adasBook = (await ensureBook(t.database, t.ada.id)).id;
  gracesBook = (await ensureBook(t.database, t.grace.id)).id;
  fake = await startFakeFrankfurter();
  defaultRates = { ...fake.rates };
});
afterAll(async () => {
  await fake.close();
  await t.close();
});
beforeEach(async () => {
  fake.requests.length = 0;
  fake.date = '2026-11-06';
  fake.rates = { ...defaultRates };
  fake.behaviour = { kind: 'rates' };
  await dbRun(
    t.database,
    sql`DELETE FROM ${tableNamed(t.database, 'fx_rate')} WHERE currency <> ''`,
  );
});

const NOW = new Date('2026-11-07T10:00:00Z');
const options = () => ({ url: fake.url, now: NOW });
const stored = () =>
  dbAll<{ currency: string; asOf: string; rate: string; source: string }>(
    t.database,
    sql`SELECT currency AS currency, as_of AS "asOf", rate AS rate, source AS source
          FROM ${tableNamed(t.database, 'fx_rate')} ORDER BY currency, as_of`,
  );

describe(`fetching rates (${leg})`, () => {
  it('makes no request on a fresh instance, or one that uses no currency but USD', async () => {
    expect(await currenciesInUse(t.database)).toEqual([]);
    expect(await fetchRates(t.database, options())).toEqual({
      wanted: 0,
      stored: 0,
      requested: false,
    });
    await addCurrency(t.database, t.ada.id, adasBook, 'USD');
    expect(await currenciesInUse(t.database)).toEqual([]);
    expect((await fetchRates(t.database, options())).requested).toBe(false);
    expect(fake.requests).toEqual([]);
    expect(await stored()).toEqual([]);
  });

  it('stores one row per currency in use, for the day the answer is for, and no others', async () => {
    await addCurrency(t.database, t.ada.id, adasBook, 'EUR');
    await addCurrency(t.database, t.ada.id, adasBook, 'JPY');
    // Another person's use of the same currency is one currency wanted, not two; and hers alone is wanted too.
    await addCurrency(t.database, t.grace.id, gracesBook, 'EUR');
    await addCurrency(t.database, t.grace.id, gracesBook, 'BHD');
    expect(await currenciesInUse(t.database)).toEqual(['BHD', 'EUR', 'JPY']);

    expect(await fetchRates(t.database, options())).toEqual({
      wanted: 3,
      stored: 3,
      requested: true,
    });
    expect(fake.requests).toEqual(['/v1/latest?base=USD']);
    // GBP and CAD are in the answer and nobody uses them, so they are not kept; USD is the pivot and has no row.
    expect(await stored()).toEqual([
      { currency: 'BHD', asOf: '2026-11-06', rate: '0.376', source: 'frankfurter' },
      { currency: 'EUR', asOf: '2026-11-06', rate: '0.86312', source: 'frankfurter' },
      { currency: 'JPY', asOf: '2026-11-06', rate: '154.38', source: 'frankfurter' },
    ]);
  });

  it('stores one row per currency and day however many runs there are, and however many at once', async () => {
    await fetchRates(t.database, options());
    await fetchRates(t.database, options());
    expect((await stored()).length).toBe(3);
    await dbRun(
      t.database,
      sql`DELETE FROM ${tableNamed(t.database, 'fx_rate')} WHERE currency <> ''`,
    );
    const results = await Promise.all(
      Array.from({ length: 4 }, () => fetchRates(t.database, options())),
    );
    expect(results.reduce((sum, each) => sum + each.stored, 0)).toBe(3);
    expect((await stored()).length).toBe(3);
  });

  it('keeps the first row of a day: a later answer for the same day changes nothing', async () => {
    await fetchRates(t.database, options());
    fake.rates = { ...fake.rates, EUR: '0.99999' };
    expect((await fetchRates(t.database, options())).stored).toBe(0);
    expect((await stored()).find((row) => row.currency === 'EUR')?.rate).toBe('0.86312');
  });

  it('adds a row for a new day and keeps the earlier ones', async () => {
    await fetchRates(t.database, options());
    fake.date = '2026-11-09';
    fake.rates = { ...fake.rates, EUR: '0.87' };
    expect(
      (await fetchRates(t.database, { ...options(), now: new Date('2026-11-09T10:00:00Z') }))
        .stored,
    ).toBe(3);
    expect(
      (await stored()).filter((row) => row.currency === 'EUR').map((row) => [row.asOf, row.rate]),
    ).toEqual([
      ['2026-11-06', '0.86312'],
      ['2026-11-09', '0.87'],
    ]);
  });

  it('does not fail for a currency the source does not list: it has no rate, and the rest are stored', async () => {
    await addCurrency(t.database, t.ada.id, adasBook, 'ZMW');
    expect(await currenciesInUse(t.database)).toContain('ZMW');
    const result = await fetchRates(t.database, options());
    expect(result).toEqual({ wanted: 4, stored: 3, requested: true });
    expect((await stored()).map((row) => row.currency)).toEqual(['BHD', 'EUR', 'JPY']);
    expect(await rateOn(t.database, 'ZMW', '2026-11-07')).toBeUndefined();
  });

  it('stores nothing, and says why by kind, when the answer is wrong', async () => {
    fake.behaviour = {
      kind: 'body',
      body: '{"base":"USD","date":"2026-11-06","rates":{"EUR":0.86,"JPY":"bad"}}',
    };
    await expect(fetchRates(t.database, options())).rejects.toBeInstanceOf(FxError);
    expect(await stored()).toEqual([]);
    fake.behaviour = { kind: 'status', status: 503 };
    await expect(fetchRates(t.database, options())).rejects.toMatchObject({ code: 'status' });
    expect(await stored()).toEqual([]);
  });

  it('refuses to write what is not a rate, whoever asks', async () => {
    for (const rate of ['0', '-1', '1e5', '0.0', '', 'abc'])
      await expect(
        storeRates(t.database, '2026-11-06', new Map([['EUR', rate]]), 1),
        rate,
      ).rejects.toThrow(RangeError);
    await expect(storeRates(t.database, '2026-11-06', new Map([['USD', '1']]), 1)).rejects.toThrow(
      RangeError,
    );
    await expect(storeRates(t.database, '2026-11-06', new Map([['BTC', '1']]), 1)).rejects.toThrow(
      RangeError,
    );
    await expect(storeRates(t.database, '2026-02-30', new Map([['EUR', '1']]), 1)).rejects.toThrow(
      RangeError,
    );
    // One bad rate in a day's set stores none of the day: it is one transaction.
    await expect(
      storeRates(
        t.database,
        '2026-11-06',
        new Map([
          ['EUR', '0.86'],
          ['JPY', 'x'],
        ]),
        1,
      ),
    ).rejects.toThrow(RangeError);
    expect(await stored()).toEqual([]);
  });

  it('has no book in its table: the rates are the instance’s', async () => {
    const columns = await dbAll<{ name: string }>(
      t.database,
      t.database.dialect === 'postgres'
        ? sql`SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'fx_rate' AND table_schema = 'ledger'`
        : sql`SELECT name AS name FROM pragma_table_info('fx_rate')`,
    );
    expect(columns.map((c) => c.name).sort()).toEqual([
      'as_of',
      'currency',
      'fetched_at',
      'rate',
      'source',
    ]);
  });
});

describe(`the rate in force on a date (${leg})`, () => {
  beforeEach(async () => {
    // Friday the 6th, then Monday the 9th, and the 3rd before them.
    for (const [day, eur] of [
      ['2026-11-03', '0.85'],
      ['2026-11-06', '0.86312'],
      ['2026-11-09', '0.87'],
    ] as const)
      await storeRates(t.database, day, new Map([['EUR', eur]]), 1);
  });

  it('is the latest row not after the date', async () => {
    expect(await rateOn(t.database, 'EUR', '2026-11-06')).toEqual({
      rate: '0.86312',
      asOf: '2026-11-06',
    });
    // A weekend is Friday's rate.
    expect(await rateOn(t.database, 'EUR', '2026-11-07')).toEqual({
      rate: '0.86312',
      asOf: '2026-11-06',
    });
    expect(await rateOn(t.database, 'EUR', '2026-11-08')).toEqual({
      rate: '0.86312',
      asOf: '2026-11-06',
    });
    expect(await rateOn(t.database, 'EUR', '2026-11-09')).toEqual({
      rate: '0.87',
      asOf: '2026-11-09',
    });
    // And a date long after is the last there is.
    expect(await rateOn(t.database, 'EUR', '2027-06-01')).toEqual({
      rate: '0.87',
      asOf: '2026-11-09',
    });
  });

  it('is no rate for a date before the first, and never a later one', async () => {
    expect(await rateOn(t.database, 'EUR', '2026-11-02')).toBeUndefined();
    expect(await rateOn(t.database, 'EUR', '2020-01-01')).toBeUndefined();
  });

  it('is no rate for a currency never fetched', async () => {
    expect(await rateOn(t.database, 'GBP', '2026-11-09')).toBeUndefined();
  });

  it('is one for the dollar on every day, whatever the table holds', async () => {
    expect(await rateOn(t.database, 'USD', '1999-12-31')).toEqual({
      rate: '1',
      asOf: '1999-12-31',
    });
  });

  it('is a mistake, not an absence, to ask with a code or a date that is not one', async () => {
    await expect(rateOn(t.database, 'BTC', '2026-11-09')).rejects.toThrow(RangeError);
    await expect(rateOn(t.database, "EUR'; DROP TABLE fx_rate;--", '2026-11-09')).rejects.toThrow(
      RangeError,
    );
    await expect(rateOn(t.database, 'EUR', '2026-11-31')).rejects.toThrow(RangeError);
    await expect(rateOn(t.database, 'EUR', "2026-11-09' OR '1'='1")).rejects.toThrow(RangeError);
  });
});

describe(`the fetch-rates job (${leg})`, () => {
  const job = (url: string | undefined = undefined) =>
    fetchRatesJob({
      fx: { enabled: true, url: url ?? fake.url },
      database: async () => t.database,
    });
  const context = () => ({ now: NOW, signal: new AbortController().signal });

  it('runs at start and on an interval, under a name the log can use', () => {
    expect(job()).toMatchObject({ name: 'fetch-rates', runAtStart: true });
    expect(job().everyMs).toBeGreaterThan(0);
  });

  it('fetches and stores when it runs, and a second run stores nothing more', async () => {
    await job().run(context());
    expect((await stored()).length).toBe(3);
    await job().run(context());
    expect((await stored()).length).toBe(3);
    expect(fake.requests).toHaveLength(2);
  });

  it('fails by kind, and the runner logs the kind and nothing of the address or the answer', async () => {
    fake.behaviour = { kind: 'status', status: 500 };
    const lines: string[] = [];
    const deps: RunnerDeps = {
      now: () => NOW,
      setTimer: () => 0,
      clearTimer: () => undefined,
      log: (line) => lines.push(line),
    };
    const runner = new JobRunner(deps);
    runner.register(job());
    await runner.runNow('fetch-rates');
    expect(lines).toEqual(['[ledger] job fetch-rates failed: FxError status']);
    expect(kindOf(new FxError('status'))).toBe('FxError status');
    expect(lines.join('')).not.toContain('127.0.0.1');
    expect(await stored()).toEqual([]);
  });

  it('asks the address LEDGER_FX_URL names, and nowhere else', async () => {
    const other = await startFakeFrankfurter();
    try {
      await job(other.url).run(context());
      expect(other.requests).toEqual(['/v1/latest?base=USD']);
      expect(fake.requests).toEqual([]);
    } finally {
      await other.close();
    }
  });
});
