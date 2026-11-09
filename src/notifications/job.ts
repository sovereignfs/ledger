import { sql } from 'drizzle-orm';
import { monthOf, todayIn } from '../dates';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { loadInsights } from '../insights/load';
import { type Book, findBook } from '../ledger/books';
import type { JobDefinition } from '../jobs/runner';
import { listUpcoming } from '../recurring/recurring';
import { type Channel, type Outgoing, fanOut } from './channels';
import { claimMark } from './marks';
import { sendRecap } from './recap';

/**
 * **The notices Ledger sends on its own** (DESIGN.md §13.4, task 10.1), through the channels the server has (`server.ts`): **last month's recap** (`recap.ts`), **the daily count of bills waiting to be confirmed**
 * (the ones due today and the ones overdue, once for a book and a day by its own calendar, with the count and no name or amount) and **an insight that newly fires** (once for an insight
 * and a month). Each is **claimed before it is sent** (`marks.ts`), so two runs, or two processes, send it once, and a send whose answer was lost is not made again. **With no channel
 * nothing is claimed**, so a channel turned on later does not send what was waiting. A notice is for the book's owner, and what is logged is the kind and the outcome and never what it said.
 */
const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

export interface NotifyResult {
  readonly claimed: number;
}

/** The books, each with the account that owns it. */
export async function booksWithOwners(
  database: Database,
): Promise<{ bookId: string; owner: string }[]> {
  const s = schema(database);
  const rows = await dbAll<{ bookId: string; owner: string }>(
    database,
    sql`SELECT b.id AS "bookId", m.account_id AS owner
          FROM ${s.book} b JOIN ${s.bookMember} m ON m.book_id = b.id AND m.role = 'owner'
         WHERE m.created_at = (SELECT MIN(x.created_at) FROM ${s.bookMember} x WHERE x.book_id = b.id AND x.role = 'owner')
         ORDER BY b.created_at, b.id`,
  );
  return rows;
}

export const upcomingNotice = (count: number, today: string, bookId: string): Outgoing => ({
  accountId: '',
  kind: 'upcoming',
  title:
    count === 1
      ? '1 bill is waiting to be confirmed'
      : `${count} bills are waiting to be confirmed`,
  path: '/transactions',
  key: `upcoming:${bookId}:${today}`,
});

export async function notifyDue(
  database: Database,
  channels: readonly Channel[],
  now: Date = new Date(),
  log: (line: string) => void = () => undefined,
): Promise<NotifyResult> {
  if (channels.length === 0) return { claimed: 0 };
  let claimed = 0;
  for (const { bookId, owner } of await booksWithOwners(database)) {
    const book = (await findBook(database, owner)) as Book | undefined;
    if (!book || book.id !== bookId) continue;
    const today = todayIn(book.timeZone, now);
    const month = monthOf(today);

    // The bills waiting: today's and the overdue.
    const waiting = await listUpcoming(database, owner, bookId, book.timeZone, now, 0);
    if (
      waiting.length > 0 &&
      (await claimMark(database, owner, bookId, 'upcoming', today, now.getTime()))
    ) {
      claimed++;
      await fanOut(
        channels,
        { ...upcomingNotice(waiting.length, today, bookId), accountId: owner },
        log,
      );
    }

    // Last month's recap, in the first days of this one, if the book has it on.
    if (await sendRecap(database, channels, owner, book, now, log)) claimed++;

    // The insights that fire now, each once for the month it fires in.
    for (const insight of await loadInsights(database, owner, book, now, { limit: 3 })) {
      if (
        !(await claimMark(
          database,
          owner,
          bookId,
          'insight',
          `${insight.id}:${month}`,
          now.getTime(),
        ))
      )
        continue;
      claimed++;
      await fanOut(
        channels,
        {
          accountId: owner,
          kind: 'insight',
          title: insight.text,
          path: insight.href,
          key: `insight:${bookId}:${insight.id}:${month}`,
        },
        log,
      );
    }
  }
  return { claimed };
}

/** An hour, so the daily count goes within the hour of the day beginning in its book's own zone. */
export const NOTIFY_EVERY_MS = 60 * 60 * 1000;

export function notifyJob(deps: {
  database: () => Promise<Database>;
  channels: () => Promise<readonly Channel[]>;
}): JobDefinition {
  return {
    name: 'notify',
    everyMs: NOTIFY_EVERY_MS,
    async run({ now }) {
      await notifyDue(await deps.database(), await deps.channels(), now, (line) =>
        console.info(`[ledger] ${line}`),
      );
    },
  };
}
