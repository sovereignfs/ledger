import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { createAccount } from '../ledger/accounts';
import { ensureBook } from '../ledger/books';
import type { ExportFile } from '../portability/format';
import { MAX_IMPORT_BYTES, download, fileNameFor, upload } from './portability-api';
import { type BookHandler, bookRoute } from './route';
import { type Person, type TwoAccounts, twoAccounts } from './two-accounts';

/** The export and import routes, **called as the second person** (DESIGN.md §5.2): each person's file is their own book's, and an import goes into their own book alone. */
const { leg } = testTarget();

let t: TwoAccounts;
beforeAll(async () => {
  t = await twoAccounts();
  const ada = await ensureBook(t.database, t.ada.id);
  await ensureBook(t.database, t.grace.id);
  const made = await createAccount(t.database, t.ada.id, ada.id, {
    type: 'bank',
    name: 'Ada’s secret bank',
    currency: 'USD',
    opening: { amount: 12_345, date: '2026-01-01' },
  });
  if (!made.ok) throw new Error('not made');
});
afterAll(async () => t.close());

const call = (
  handler: (database: typeof t.database, context: Parameters<BookHandler>[0]) => Promise<Response>,
  person: Person | null,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  bookRoute((context) => handler(t.database, context), t.deps)(t.request(person, path, init), {
    params: Promise.resolve({}),
  });
const exported = async (person: Person) => (await call(download, person, '/api/export')).text();
const send = (person: Person | null, text: string, headers?: Record<string, string>) =>
  // A file is the body as it is; the helper sends JSON, so the text is sent as a JSON string and read back by the test through `body`.
  call(upload, person, '/api/import', {
    method: 'POST',
    body: JSON.parse(text),
    ...(headers ? { headers } : {}),
  });

describe('the name of a download', () => {
  it('is the book and the day, with nothing in it a file name cannot hold', () => {
    expect(fileNameFor('My budget', '2026-11-09')).toBe('ledger-my-budget-2026-11-09.json');
    expect(fileNameFor('Ünï/cödé "x"', '2026-11-09')).toBe('ledger-n-c-d-x-2026-11-09.json');
    expect(fileNameFor('   ', '2026-11-09')).toBe('ledger-book-2026-11-09.json');
    expect(fileNameFor('a'.repeat(200), '2026-11-09').length).toBeLessThan(70);
  });
});

describe(`the export route (${leg})`, () => {
  it('gives the caller’s own book as a download, and nothing of the other person’s', async () => {
    const reply = await call(download, t.ada, '/api/export');
    expect(reply.status).toBe(200);
    expect(reply.headers.get('content-type')).toBe('application/json');
    expect(reply.headers.get('content-disposition')).toMatch(
      /^attachment; filename="ledger-my-budget-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(reply.headers.get('cache-control')).toBe('no-store');
    const mine = JSON.parse(await reply.text()) as ExportFile;
    expect(mine.tables.money_account?.map((row) => row.name)).toContain('Ada’s secret bank');
    expect(await exported(t.grace)).not.toContain('secret');
    expect((await call(download, null, '/api/export')).status).toBe(401);
  });
});

describe(`the import route (${leg})`, () => {
  it('imports a file into the caller’s own empty book, and refuses one into a book that has things in it', async () => {
    const file = await exported(t.ada);
    const into = await send(t.grace, file);
    expect(into.status).toBe(201);
    expect(((await into.json()) as { rows: number }).rows).toBeGreaterThan(0);
    expect(await exported(t.grace)).toContain('Ada’s secret bank');
    const again = await send(t.grace, file);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { problems: string[] }).problems[0]).toContain('empty book');
    // A book with things in it, which is the person's own: Ada's.
    expect((await send(t.ada, file)).status).toBe(409);
  });

  it('refuses a file that is not one with sentences and a 400, another address with a 403, no one with a 401, and one that is too large with a 413', async () => {
    const bad = await send(t.grace, JSON.stringify({ format: 'ledger', version: 99 }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { problems: string[] }).problems[0]).toContain('newer version');
    expect((await send(t.grace, '{}')).status).toBe(400);
    expect(
      (await send(t.grace, JSON.stringify({}), { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await send(null, '{}')).status).toBe(401);
    expect(
      (await send(t.grace, '{}', { 'content-length': String(MAX_IMPORT_BYTES + 1) })).status,
    ).toBe(413);
  });
});

describe(`the line on the activity page (${leg})`, () => {
  const logged: { accountId: string; summary: string; path: string; key: string }[] = [];
  const record = async (entry: (typeof logged)[number]) => {
    logged.push(entry);
    return { outcome: 'sent' as const };
  };
  const via = (
    handler: typeof download | typeof upload,
    person: Person,
    path: string,
    activity: Parameters<typeof download>[2],
    init: { method?: string; body?: unknown } = {},
  ) =>
    bookRoute((context) => handler(t.database, context, activity), t.deps)(
      t.request(person, path, init),
      { params: Promise.resolve({}) },
    );

  it('says an export and an import to the person who did it, with no figure of the book, and nothing for a file that was refused', async () => {
    logged.length = 0;
    expect((await via(download, t.ada, '/api/export', record)).status).toBe(200);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.accountId).toBe(t.ada.id);
    expect(logged[0]?.summary).toBe('You exported your book');
    expect(JSON.stringify(logged)).not.toContain('secret');
    // A refused import (Ada's book is not empty) writes no line.
    const file = JSON.parse(await exported(t.ada));
    expect(
      (await via(upload, t.ada, '/api/import', record, { method: 'POST', body: file })).status,
    ).toBe(409);
    expect(logged).toHaveLength(1);
  });

  it('is never a reason for the export to fail: a logger that throws or is refused leaves the answer as it was', async () => {
    const broken = async () => {
      throw new Error('core is down');
    };
    expect((await via(download, t.ada, '/api/export', broken)).status).toBe(200);
  });
});
