import { create, list } from '@/src/access/accounts-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// The accounts of the person's book (DESIGN.md §6.1). What each does is in `src/access/accounts-api.ts`, so that it is tested as a second person.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => list(await getDatabase(), context));
export const POST = bookRoute(async (context) => create(await getDatabase(), context));
