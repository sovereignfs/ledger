import { create, list, reorder } from '@/src/access/categories-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// The categories of the person's book (DESIGN.md §7.1). What each does is in `src/access/categories-api.ts`, so that it is tested as a second person.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => list(await getDatabase(), context));
export const POST = bookRoute(async (context) => create(await getDatabase(), context));
export const PUT = bookRoute(async (context) => reorder(await getDatabase(), context));
