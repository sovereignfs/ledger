import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FxError,
  fetchLatestRates,
  isRateText,
  latestUrl,
  parseLatest,
  type FxFailure,
} from './frankfurter';
import { isCalendarDay } from '../dates';
import { startFakeFrankfurter, type FakeFrankfurter } from './testing/fake-frankfurter';

const NOW = new Date('2026-11-07T10:00:00Z');
const body = (over: Record<string, string> = {}) =>
  `{"amount":1.0,"base":"${over.base ?? 'USD'}","date":"${over.date ?? '2026-11-06'}","rates":${over.rates ?? '{"EUR":0.86312,"JPY":154.38}'}}`;
const kind = (run: () => unknown): FxFailure | 'none' => {
  try {
    run();
    return 'none';
  } catch (error) {
    if (error instanceof FxError) return error.code;
    throw error;
  }
};

describe('reading the answer', () => {
  it('keeps each rate as the text it arrived as, so that no digit goes through a double', () => {
    const latest = parseLatest(
      body({ rates: '{"EUR":0.86312,"JPY":154.38,"KWD":0.30699999999999994}' }),
      NOW,
    );
    expect(latest.asOf).toBe('2026-11-06');
    expect([...latest.rates]).toEqual([
      ['EUR', '0.86312'],
      ['JPY', '154.38'],
      ['KWD', '0.30699999999999994'],
    ]);
    // A double cannot hold this: the text must be what was read, not what a float prints.
    expect(parseLatest(body({ rates: '{"EUR":0.123456789012345678}' }), NOW).rates.get('EUR')).toBe(
      '0.123456789012345678',
    );
  });

  it('ignores a code that is not a currency of ours and the pivot itself, and trusts neither', () => {
    const latest = parseLatest(body({ rates: '{"EUR":0.86,"BTC":0.00001,"XXX":1,"USD":1}' }), NOW);
    expect([...latest.rates.keys()]).toEqual(['EUR']);
  });

  it('refuses what is not what it promises, each by its kind', () => {
    expect(kind(() => parseLatest('not json', NOW))).toBe('not_json');
    expect(kind(() => parseLatest('[]', NOW))).toBe('shape');
    expect(kind(() => parseLatest('null', NOW))).toBe('shape');
    expect(kind(() => parseLatest(body({ base: 'EUR' }), NOW))).toBe('base');
    expect(kind(() => parseLatest(body({ date: '2026-02-30' }), NOW))).toBe('date');
    expect(kind(() => parseLatest(body({ date: '06/11/2026' }), NOW))).toBe('date');
    expect(kind(() => parseLatest(body({ rates: '[1]' }), NOW))).toBe('shape');
    expect(kind(() => parseLatest(body({ rates: '{"EUR":"0.86"}' }), NOW))).toBe('rate');
    expect(kind(() => parseLatest(body({ rates: '{"EUR":0}' }), NOW))).toBe('rate');
    expect(kind(() => parseLatest(body({ rates: '{"EUR":-0.86}' }), NOW))).toBe('rate');
    expect(kind(() => parseLatest(body({ rates: '{"EUR":1e-7}' }), NOW))).toBe('rate');
    expect(kind(() => parseLatest(body({ rates: '{"EUR":1e21}' }), NOW))).toBe('rate');
    expect(kind(() => parseLatest(body({ rates: '{"EUR":null}' }), NOW))).toBe('rate');
  });

  it('refuses a day after tomorrow, which would be in force on every date until then, and takes tomorrow for a zone ahead', () => {
    expect(kind(() => parseLatest(body({ date: '2026-11-09' }), NOW))).toBe('future');
    expect(kind(() => parseLatest(body({ date: '2026-11-08' }), NOW))).toBe('none');
  });

  it('knows a day and a rate when it sees one', () => {
    expect(['2026-11-06', '2028-02-29'].every(isCalendarDay)).toBe(true);
    expect(['2026-02-29', '2026-13-01', '2026-1-1', ''].some(isCalendarDay)).toBe(false);
    expect(['0.5', '157.19', '1'].every(isRateText)).toBe(true);
    expect(['0', '0.0', '-1', '1e5', '.5', '01', 'NaN', '1,5'].some(isRateText)).toBe(false);
  });
});

describe('asking for them', () => {
  it('asks for the latest against USD, with a version in the address or without', () => {
    expect(latestUrl()).toBe('https://api.frankfurter.dev/v1/latest?base=USD');
    expect(latestUrl('https://mirror.example/')).toBe('https://mirror.example/v1/latest?base=USD');
    expect(latestUrl('https://mirror.example/v1')).toBe(
      'https://mirror.example/v1/latest?base=USD',
    );
  });

  let fake: FakeFrankfurter;
  beforeEach(async () => {
    fake = await startFakeFrankfurter();
  });
  afterEach(async () => fake.close());

  it('makes one request, which carries no currency code', async () => {
    const latest = await fetchLatestRates({ url: fake.url, now: NOW });
    expect(latest.rates.get('EUR')).toBe('0.86312');
    expect(fake.requests).toEqual(['/v1/latest?base=USD']);
  });

  it('answers each way the other side can fail with a kind, and with nothing from the other side', async () => {
    const kinds: [typeof fake.behaviour, FxFailure][] = [
      [{ kind: 'status', status: 500 }, 'status'],
      [{ kind: 'status', status: 404 }, 'status'],
      [{ kind: 'redirect' }, 'redirect'],
      [{ kind: 'body', body: '<html>' }, 'not_json'],
      [{ kind: 'body', body: 'x'.repeat(300 * 1024) }, 'too_large'],
    ];
    for (const [behaviour, expected] of kinds) {
      fake.behaviour = behaviour;
      const error = await fetchLatestRates({ url: fake.url, now: NOW }).catch((e: unknown) => e);
      expect(error, expected).toBeInstanceOf(FxError);
      expect((error as FxError).code).toBe(expected);
      expect((error as FxError).message).not.toContain('127.0.0.1');
    }
  });

  it('gives up after its time limit, and when told to stop', async () => {
    fake.behaviour = { kind: 'hang' };
    const slow = await fetchLatestRates({ url: fake.url, now: NOW, timeoutMs: 50 }).catch(
      (e: unknown) => e,
    );
    expect((slow as FxError).code).toBe('timeout');
    const stop = new AbortController();
    const stopped = fetchLatestRates({ url: fake.url, now: NOW, signal: stop.signal }).catch(
      (e: unknown) => e,
    );
    stop.abort();
    expect(((await stopped) as FxError).code).toBe('network');
  });

  it('says network for an address nothing is listening on', async () => {
    const error = await fetchLatestRates({ url: 'http://127.0.0.1:1', now: NOW }).catch(
      (e: unknown) => e,
    );
    expect((error as FxError).code).toBe('network');
  });
});
