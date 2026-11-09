import { isCalendarDay } from '../dates';
import { FX_PIVOT_CODE, isSupportedCurrencyCode } from '../money/currencies';

/**
 * Frankfurter's answer to "what is every currency worth in US dollars", read with nothing assumed of it (DESIGN.md §9.2). It is the only thing Ledger asks of
 * the network for money, and **nothing of a book is in the request**: one `GET` with the pivot as its base and no list of codes, so a currency Frankfurter does
 * not cover is not asked for and cannot fail the request, and the codes a person uses are not even revealed. The answer is filtered to the codes wanted, here
 * and not there.
 *
 * What comes back is checked as hostile input, since `LEDGER_FX_URL` may name a mirror: the pivot as the base, a real calendar day, a currency that is an ISO
 * one, a rate that is plain digits. **A rate is kept as the text it arrived as** (the JSON number's source, not a float read from it), so that no digit is lost
 * to a double before conversion is done exactly (§9.3). An error carries a kind and never the address, the body or a message from the other side.
 */

/** Frankfurter's own address; `LEDGER_FX_URL` replaces it. */
export const DEFAULT_FX_URL = 'https://api.frankfurter.dev';

/** How long the request may take before it is given up, in milliseconds. */
export const FX_TIMEOUT_MS = 10_000;

/** The most of an answer that is read: the real one is a few kilobytes, and a mirror that sends more is not one. */
const MAX_BODY = 256 * 1024;

export type FxFailure =
  | 'network'
  | 'timeout'
  | 'status'
  | 'redirect'
  | 'too_large'
  | 'not_json'
  | 'shape'
  | 'base'
  | 'date'
  | 'rate'
  | 'future';

/** What went wrong in fetching rates, by kind: the name and `code` are what the job runner logs. */
export class FxError extends Error {
  readonly code: FxFailure;
  constructor(code: FxFailure) {
    super(`exchange rates: ${code}`);
    this.name = 'FxError';
    this.code = code;
  }
}

/** One day's rates against USD: `rates` maps a currency to how many of it one US dollar buys, as a decimal string. */
export interface LatestRates {
  readonly asOf: string;
  readonly rates: ReadonlyMap<string, string>;
}

/** A JSON number held as the text it was written as. */
class RawNumber {
  constructor(readonly source: string) {}
}

const DECIMAL = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,18})?$/;

/** A rate that can be stored and converted exactly: plain digits, more than zero, no exponent and no sign. */
export function isRateText(value: string): boolean {
  return DECIMAL.test(value) && /[1-9]/.test(value);
}

/**
 * Reads Frankfurter's `GET /v1/latest?base=USD` body. Throws `FxError` for anything that is not what it promises. `now` is the clock, given: a day later than
 * tomorrow is refused, since a row dated in the future would be "the latest not after" every date until then.
 */
export function parseLatest(body: string, now: Date): LatestRates {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body, (_key, value, context?: { source?: string }) =>
      typeof value === 'number' ? new RawNumber(context?.source ?? String(value)) : value,
    );
  } catch {
    throw new FxError('not_json');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new FxError('shape');
  const answer = parsed as Record<string, unknown>;
  if (answer.base !== FX_PIVOT_CODE) throw new FxError('base');

  const date = answer.date;
  if (typeof date !== 'string' || !isCalendarDay(date)) throw new FxError('date');
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (date > tomorrow) throw new FxError('future');

  const raw = answer.rates;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new FxError('shape');
  const rates = new Map<string, string>();
  for (const [code, value] of Object.entries(raw)) {
    // A code that is not a currency of ours is ignored, not trusted; one that is must carry a rate that is exact.
    if (!isSupportedCurrencyCode(code) || code === FX_PIVOT_CODE) continue;
    if (!(value instanceof RawNumber) || !isRateText(value.source)) throw new FxError('rate');
    rates.set(code, value.source);
  }
  return { asOf: date, rates };
}

/** The address of the latest rates against the pivot, under the service's own, which may or may not name its version already. */
export function latestUrl(base: string = DEFAULT_FX_URL): string {
  const root = base.replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${root}/v1/latest?base=${FX_PIVOT_CODE}`;
}

export interface FetchOptions {
  /** `LEDGER_FX_URL`, or Frankfurter's own. */
  readonly url?: string;
  readonly now: Date;
  /** Aborted when the process is stopping. */
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Replaceable so that a test needs no network; `fetch` is the default. */
  readonly fetch?: typeof fetch;
}

/** Asks Frankfurter for the latest rates and reads the answer: one request, with no redirect followed and a time limit. */
export async function fetchLatestRates(options: FetchOptions): Promise<LatestRates> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? FX_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(latestUrl(options.url), {
      method: 'GET',
      headers: { accept: 'application/json' },
      // A mirror that redirects is a mirror that moved, which the operator is told by a failure and not followed to an address of someone's choosing.
      redirect: 'manual',
      signal,
    });
  } catch {
    throw new FxError(timeout.aborted ? 'timeout' : 'network');
  }
  try {
    if (response.status >= 300 && response.status < 400) throw new FxError('redirect');
    if (!response.ok) throw new FxError('status');
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_BODY) throw new FxError('too_large');
    const body = await readCapped(response);
    return parseLatest(body, options.now);
  } catch (error) {
    if (error instanceof FxError) throw error;
    throw new FxError(timeout.aborted ? 'timeout' : 'network');
  } finally {
    // Whatever was not read is let go, so that the connection is not held.
    void response.body?.cancel().catch(() => undefined);
  }
}

/** The body as text, refused past `MAX_BODY` bytes whatever the headers said. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) throw new FxError('too_large');
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
