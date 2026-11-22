import { describe, expect, it } from 'vitest';
import { bookRecords } from './core-export';
import { FORMAT, VERSION, type ExportFile } from './format';

/** A person's part of core's export (`signIn.export`): the book, as the records the export format asks for (`contracts/export.md` §3). */
const file: ExportFile = {
  format: FORMAT,
  version: VERSION,
  exportedAt: Date.UTC(2026, 10, 22),
  book: {
    name: 'Home',
    baseCurrency: 'EUR',
    timeZone: 'Europe/Berlin',
    firstDayOfWeek: 1,
    locale: null,
    recap: true,
    setupDoneAt: Date.UTC(2026, 0, 2, 3, 4, 5),
  },
  tables: {
    account: [{ id: 'a1', name: 'Current', created_at: Date.UTC(2026, 0, 1), balance: 1234 }],
    payee: [],
  },
};

describe('a person’s book in core’s export', () => {
  it('is its settings as `book`, then a file of records for each table that has rows, under the app’s own folder', () => {
    const parts = bookRecords(file);
    expect(parts.map(({ path, kind }) => [path, kind])).toEqual([
      ['apps/ledger/records/book.jsonl', 'book'],
      ['apps/ledger/records/account.jsonl', 'account'],
    ]);
  });

  it('writes a time as ISO 8601 in UTC, and every other value as it is', () => {
    const [book, account] = bookRecords(file);
    expect(book?.records[0]).toMatchObject({
      setupDoneAt: '2026-01-02T03:04:05.000Z',
      name: 'Home',
    });
    expect(account?.records[0]).toEqual({
      id: 'a1',
      name: 'Current',
      created_at: '2026-01-01T00:00:00.000Z',
      balance: 1234,
    });
  });

  it('names each kind as the format allows: lower case, letters, digits and underscores', () => {
    for (const part of bookRecords(file)) expect(part.kind).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
