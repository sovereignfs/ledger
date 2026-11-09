import { create, list } from '@/src/access/recurring-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// The recurring entries of the person's book (DESIGN.md §8). What each does is in `src/access/recurring-api.ts`, tested as a second person.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => list(await getDatabase(), context));
export const POST = bookRoute(async (context) => create(await getDatabase(), context));
