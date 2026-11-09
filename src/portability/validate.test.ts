import { describe, expect, it } from 'vitest';
import { FILE_TABLES, FORMAT, TABLES, VERSION, fileColumns } from './format';
import { parseExport } from './validate';

/**
 * A file is untrusted input (DESIGN.md §16): the names it uses for tables and columns are looked up in lists the app owns, and a name that is not in them, **among them the names
 * that mean something to JavaScript itself**, is a refusal and not a lookup.
 */
const book = {
  name: 'Mine',
  baseCurrency: 'USD',
  timeZone: 'UTC',
  firstDayOfWeek: 1,
  locale: null,
  recap: true,
  setupDoneAt: null,
};
const emptyTables = () => Object.fromEntries(FILE_TABLES.map((name) => [name, [] as unknown[]]));
const file = (tables: Record<string, unknown>) =>
  `{"format":"${FORMAT}","version":${VERSION},"exportedAt":1,"book":${JSON.stringify(book)},"tables":${JSON.stringify(tables)}}`;

describe('a file’s own names', () => {
  it('reads a file with every table empty', () => {
    expect(parseExport(file(emptyTables())).ok).toBe(true);
  });

  it('refuses a table named for what an object has, or one this version does not know', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'not_a_table']) {
      // Written as text, since an object literal's `__proto__` is not a key and JSON's is.
      const text = file(emptyTables()).replace(
        '"tables":{',
        `"tables":{${JSON.stringify(name)}:[],`,
      );
      const result = parseExport(text);
      expect(result.ok, name).toBe(false);
    }
  });

  it('refuses a row with a column named for what an object has, and a row of another shape', () => {
    const first = FILE_TABLES[0] as string;
    for (const row of [{ ['__proto__']: 1 }, { constructor: 'x' }, {}, [], 'text', null]) {
      const tables = { ...emptyTables(), [first]: [JSON.parse(JSON.stringify(row))] };
      expect(parseExport(file(tables)).ok).toBe(false);
    }
    const text = file({ ...emptyTables(), [first]: [0] }).replace(
      '[0]',
      '[{"__proto__":{"polluted":true}}]',
    );
    expect(parseExport(text).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses a row that has every column and one more, though that one is harmless', () => {
    const spec = TABLES[0];
    if (!spec) throw new Error('no tables');
    const row = Object.fromEntries(
      fileColumns(undefined, spec).map((column) => [
        column.name,
        column.dataType === 'number' ? 1 : column.dataType === 'boolean' ? true : 'x',
      ]),
    );
    expect(parseExport(file({ ...emptyTables(), [spec.table]: [row] })).ok).toBe(true);
    expect(parseExport(file({ ...emptyTables(), [spec.table]: [{ ...row, extra: 1 }] })).ok).toBe(
      false,
    );
  });

  it('refuses text that is not JSON, a different format, and a version from the future', () => {
    expect(parseExport('{{').ok).toBe(false);
    expect(parseExport('{"format":"other","version":1}').ok).toBe(false);
    expect(parseExport(`{"format":"${FORMAT}","version":${VERSION + 1}}`).ok).toBe(false);
  });
});
