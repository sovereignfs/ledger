import { upcoming } from '@/src/access/recurring-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// What waits to be confirmed in the person's book (DESIGN.md §8.2). What it does is in `src/access/recurring-api.ts`, tested as a second person.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => upcoming(await getDatabase(), context));
