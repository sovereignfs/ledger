import {
  EQUITY_KINDS,
  TXN_STATUSES,
  TXN_TYPES,
  type LineInput,
  type TxnInput,
} from '../ledger/validate';
import type { Parsed } from './account-input';

/**
 * What a request says about an entry, read from JSON that anyone may send (DESIGN.md §5.2): **types are checked before anything is trusted**, an unknown field
 * is ignored and never copied, and a line is rebuilt from the fields it may have. The values are checked again, as sentences, where they are written
 * (`src/ledger/validate.ts`); whose book it is, is never in the body.
 */
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function lineOf(value: unknown): LineInput | undefined {
  if (!isObject(value)) return undefined;
  const { account, subcategory, incomeSource, equity, amount, currency } = value;
  if (typeof amount !== 'number' || typeof currency !== 'string') return undefined;
  for (const text of [account, subcategory, incomeSource, equity])
    if (text !== undefined && typeof text !== 'string') return undefined;
  if (equity !== undefined && !(EQUITY_KINDS as readonly string[]).includes(equity as string))
    return undefined;
  return {
    ...(account === undefined ? {} : { account: account as string }),
    ...(subcategory === undefined ? {} : { subcategory: subcategory as string }),
    ...(incomeSource === undefined ? {} : { incomeSource: incomeSource as string }),
    ...(equity === undefined ? {} : { equity: equity as LineInput['equity'] }),
    amount,
    currency,
  };
}

/** The body of writing an entry: `{ type, date, lines, note?, status?, original? }`. */
export function parseTxnInput(body: unknown): Parsed<TxnInput> {
  if (!isObject(body)) return { ok: false, problems: ['The request is not an entry.'] };
  const { type, date, note, status, original } = body;
  if (typeof type !== 'string' || !(TXN_TYPES as readonly string[]).includes(type))
    return { ok: false, problems: ['The type of the entry is not one there is.'] };
  if (typeof date !== 'string') return { ok: false, problems: ['The date is not a day.'] };
  if (!Array.isArray(body.lines) || body.lines.length > 100)
    return { ok: false, problems: ['An entry has a list of lines.'] };
  const lines: LineInput[] = [];
  for (const raw of body.lines) {
    const line = lineOf(raw);
    if (!line) return { ok: false, problems: ['A line is not a line of an entry.'] };
    lines.push(line);
  }
  if (note != null && typeof note !== 'string')
    return { ok: false, problems: ['The note is text.'] };
  if (body.payee != null && typeof body.payee !== 'string')
    return { ok: false, problems: ['The payee is text.'] };
  if (body.fromJar != null && typeof body.fromJar !== 'string')
    return { ok: false, problems: ['The jar is named by its id.'] };
  if (
    status !== undefined &&
    (typeof status !== 'string' || !(TXN_STATUSES as readonly string[]).includes(status))
  )
    return { ok: false, problems: ['The status is not pending or cleared.'] };
  let originalAmount: TxnInput['original'] = null;
  if (original != null) {
    if (
      !isObject(original) ||
      typeof original.amount !== 'number' ||
      typeof original.currency !== 'string'
    )
      return { ok: false, problems: ['The original amount is not an amount in a currency.'] };
    originalAmount = { amount: original.amount, currency: original.currency };
  }
  return {
    ok: true,
    value: {
      type: type as TxnInput['type'],
      date,
      lines,
      note: (note as string | null | undefined) ?? null,
      ...(body.payee === undefined ? {} : { payee: body.payee as string | null }),
      ...(body.fromJar === undefined ? {} : { fromJar: body.fromJar as string | null }),
      ...(status === undefined ? {} : { status: status as TxnInput['status'] }),
      original: originalAmount,
    },
  };
}
