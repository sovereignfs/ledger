import { createSovereign } from '@sovereignfs/sdk';
import { getConfig } from '../config/current';
import { getAuthDatabase, getDatabase } from '../db/boot';
import { findBook } from '../ledger/books';
import { accountOfSub } from '../sovereign/identity';
import { exportBook, type ExportFile, type Row } from './format';
import packageJson from '../../package.json';

/** One file of records in a person's export: its path in the archive, its kind and its lines. */
export interface RecordsPart {
  readonly path: string;
  readonly kind: string;
  readonly records: readonly Row[];
}

/** A time Ledger keeps in milliseconds, written as the export format asks (ISO 8601 in UTC); anything else as it is. */
function value(name: string, field: Row[string]): Row[string] {
  return typeof field === 'number' && /(_at|At)$/.test(name)
    ? new Date(field).toISOString()
    : field;
}

const timed = (row: Readonly<Record<string, Row[string]>>): Row =>
  Object.fromEntries(Object.entries(row).map(([name, field]) => [name, value(name, field)]));

/**
 * The person's book as records of the export format (`contracts/export.md` §3): its settings as `book`, then a file per table, each table's rows as the book's
 * own file holds them (`format.ts`), which leaves out what is sign-in data and who made a row. Tables with no rows are left out.
 */
export function bookRecords(file: ExportFile): RecordsPart[] {
  const parts: RecordsPart[] = [
    { path: 'apps/ledger/records/book.jsonl', kind: 'book', records: [timed({ ...file.book })] },
  ];
  for (const [table, rows] of Object.entries(file.tables)) {
    if (rows.length === 0) continue;
    parts.push({
      path: `apps/ledger/records/${table}.jsonl`,
      kind: table,
      records: rows.map(timed),
    });
  }
  return parts;
}

/**
 * What the SDK remembers of a token it has seen, so that a replay is refused. Ledger keeps its own sessions with better-auth, so this holds nothing else; it is
 * in memory, since an export asked for twice is the same export (sdk §9.1) and no harm comes of a second.
 */
const seen = new Map<string, { record: unknown; expiresAt: number }>();
const replays = {
  get: (id: string) => {
    const kept = seen.get(id);
    if (!kept || kept.expiresAt < Date.now()) return undefined;
    return kept.record as never;
  },
  set: (id: string, record: unknown, expiresAt: number) => void seen.set(id, { record, expiresAt }),
  delete: (id: string) => void seen.delete(id),
  deleteMatching: () => undefined,
};

/**
 * **Core's export of a person** (`signIn.export`, sdk §9.1): core asks for Ledger's part with a signed token, and the SDK checks it (a replay refused), answers
 * at once with an export in the contract's format, and finishes it as the records are written. A person Ledger does not know, or with no book, gets an empty
 * part. `undefined` where core is not set: the route is then not there.
 */
export async function answerCoreExport(request: Request): Promise<Response | undefined> {
  const config = getConfig();
  const core = config.auth?.sovereign;
  if (!core || !config.url) return undefined;
  const client = createSovereign({
    appUrl: config.url,
    coreUrl: new URL(core.issuer).origin,
    clientId: core.clientId,
    clientSecret: core.clientSecret,
    sessionStore: replays,
  });
  return client.auth.handleExportRequest(
    request,
    { prefix: 'ledger', version: packageJson.version },
    async ({ sub, writer }) => {
      const accountId = await accountOfSub(await getAuthDatabase(), sub);
      if (!accountId) return;
      const database = await getDatabase();
      const book = await findBook(database, accountId);
      if (!book) return;
      const file = await exportBook(database, accountId, book.id);
      if (!file) return;
      for (const part of bookRecords(file))
        await writer.addRecords(part.path, part.kind, [...part.records]);
    },
  );
}
