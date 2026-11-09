import { create, list } from '@/src/access/income-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// The income sources of the person's book (DESIGN.md §7.4). What each does is in `src/access/income-api.ts`, tested as a second person.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => list(await getDatabase(), context));
export const POST = bookRoute(async (context) => create(await getDatabase(), context));
