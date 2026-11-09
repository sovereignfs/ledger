import { read, write } from '@/src/access/budget-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// The budgeted amounts of the person's book, with their history (DESIGN.md §7.3). What each does is in `src/access/budget-api.ts`, tested as a second person.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => read(await getDatabase(), context));
export const POST = bookRoute(async (context) => write(await getDatabase(), context));
