import { checkBookPatch } from '../ledger/book-settings';
import {
  FILE_TABLES,
  FORMAT,
  type ExportFile,
  type Row,
  TABLES,
  VERSION,
  fileColumns,
} from './format';

/**
 * Reading a file (DESIGN.md §16), **the whole of it before anything is written**: it is JSON of the format `ledger` of a version this one reads, it has every table and no
 * other, every row has exactly the columns of its table with values of their kinds, every id is made once, **every reference points at a row that is in the file**, a
 * recurring entry's template points only at what is in it, and the book's settings are ones a book may have. **Pure**, over the text, so that what a stray or hostile file
 * does is tested with no database. A refusal is sentences, the first few, never a stack or a value of the file.
 */
export type Parsed = { ok: true; file: ExportFile } | { ok: false; problems: string[] };

const MAX_PROBLEMS = 8;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseExport(text: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, problems: ['This is not a Ledger file: it is not JSON.'] };
  }
  if (!isObject(value) || value.format !== FORMAT)
    return { ok: false, problems: ['This is not a Ledger file.'] };
  const version = value.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    return { ok: false, problems: ['This Ledger file has no version this app can read.'] };
  if (version > VERSION)
    return {
      ok: false,
      problems: [
        `This file is from a newer version of Ledger (version ${version}); this one reads up to version ${VERSION}. Update Ledger to read it.`,
      ],
    };

  const problems: string[] = [];
  const problem = (text: string) => {
    if (problems.length < MAX_PROBLEMS) problems.push(text);
  };
  if (typeof value.exportedAt !== 'number') problem('The file does not say when it was made.');
  const book = value.book;
  if (!isObject(book)) problem('The file has no settings for the book.');
  else {
    const { name, baseCurrency, timeZone, firstDayOfWeek, locale, recap, setupDoneAt } = book;
    if (typeof name !== 'string' || typeof timeZone !== 'string' || typeof recap !== 'boolean')
      problem('The book’s settings are not a name, a time zone and whether the recap is on.');
    else
      for (const each of checkBookPatch({
        name,
        timeZone,
        recap,
        ...(typeof baseCurrency === 'string' ? { baseCurrency } : {}),
        ...(typeof firstDayOfWeek === 'number' ? { firstDayOfWeek } : {}),
        ...(typeof locale === 'string' ? { locale } : {}),
      }))
        problem(each);
    if (baseCurrency !== null && typeof baseCurrency !== 'string')
      problem('The base currency is a code or nothing.');
    if (typeof firstDayOfWeek !== 'number') problem('The first day of the week is a number.');
    if (locale !== null && typeof locale !== 'string') problem('The locale is text or nothing.');
    if (setupDoneAt !== null && typeof setupDoneAt !== 'number')
      problem('When setup was done is a time or nothing.');
  }
  const tables = value.tables;
  if (!isObject(tables)) {
    problem('The file has no tables.');
    return { ok: false, problems };
  }
  for (const name of Object.keys(tables))
    if (!FILE_TABLES.includes(name))
      problem(`The file has a table this version does not know: ${name}.`);
  for (const name of FILE_TABLES)
    if (!Array.isArray(tables[name])) problem(`The file has no list of rows for ${name}.`);
  if (problems.length > 0) return { ok: false, problems };

  // Each row has the columns of its table and nothing else, of the kinds they are.
  const ids = new Map<string, Set<string>>();
  for (const spec of TABLES) {
    const columns = fileColumns(undefined, spec);
    const names = columns.map((column) => column.name);
    const seen = new Set<string>();
    ids.set(spec.table, seen);
    (tables[spec.table] as unknown[]).forEach((raw, at) => {
      const where = `${spec.table}, row ${at + 1}`;
      if (!isObject(raw)) return problem(`${where} is not a row.`);
      const keys = Object.keys(raw);
      if (keys.length !== names.length || keys.some((key) => !names.includes(key)))
        return problem(`${where} does not have the columns of ${spec.table}.`);
      for (const column of columns) {
        const cell = raw[column.name];
        if (cell === null) {
          if (column.notNull) problem(`${where}: ${column.name} is missing.`);
          continue;
        }
        const ok =
          column.dataType === 'number'
            ? typeof cell === 'number' && Number.isSafeInteger(cell)
            : column.dataType === 'boolean'
              ? typeof cell === 'boolean'
              : typeof cell === 'string' && cell.length <= 100_000;
        if (!ok) problem(`${where}: ${column.name} is not of its kind.`);
      }
      if (spec.id) {
        const id = raw[spec.id];
        if (typeof id !== 'string' || id === '' || id.length > 64) problem(`${where} has no id.`);
        else if (seen.has(id)) problem(`${where} has an id that another row of ${spec.table} has.`);
        else seen.add(id);
      }
    });
  }
  if (problems.length > 0) return { ok: false, problems };

  // Every reference is to a row that is in the file.
  const resolves = (table: string, id: unknown) =>
    typeof id === 'string' && (ids.get(table)?.has(id) ?? false);
  for (const spec of TABLES)
    (tables[spec.table] as Row[]).forEach((row, at) => {
      const where = `${spec.table}, row ${at + 1}`;
      for (const [column, target] of Object.entries(spec.refs))
        if (row[column] !== null && !resolves(target, row[column]))
          problem(`${where}: ${column} points at a row of ${target} that is not in the file.`);
      if (spec.poly) {
        const target = spec.poly.targets[String(row[spec.poly.kind])];
        if (target === undefined) problem(`${where}: ${spec.poly.kind} is not one there is.`);
        else if (!resolves(target, row[spec.poly.column]))
          problem(
            `${where}: ${spec.poly.column} points at a row of ${target} that is not in the file.`,
          );
      }
      if (spec.template) {
        const lines = templateLines(row[spec.template]);
        if (lines === undefined) problem(`${where}: the template is not one.`);
        else
          for (const line of lines)
            for (const [key, target] of Object.entries(TEMPLATE_REFS))
              if (line[key] !== undefined && !resolves(target, line[key]))
                problem(
                  `${where}: the template points at a row of ${target} that is not in the file.`,
                );
      }
    });
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, file: value as unknown as ExportFile };
}

/** What a recurring entry's template's lines point at, by the key they use. */
export const TEMPLATE_REFS: Readonly<Record<string, string>> = {
  account: 'money_account',
  subcategory: 'subcategory',
  incomeSource: 'income_source',
};

/** The lines of a template stored as text, or `undefined` for text that is not one. */
export function templateLines(text: unknown): Record<string, unknown>[] | undefined {
  if (typeof text !== 'string') return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (!isObject(value) || !Array.isArray(value.lines)) return undefined;
    return value.lines.every(isObject) ? (value.lines as Record<string, unknown>[]) : undefined;
  } catch {
    return undefined;
  }
}
