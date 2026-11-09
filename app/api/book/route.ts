import { change, read } from '@/src/access/book-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// The settings of the person's book (DESIGN.md §15.1). What each does is in `src/access/book-api.ts`, tested as a second person.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => read(await getDatabase(), context));
export const PATCH = bookRoute(async (context) => change(await getDatabase(), context));
