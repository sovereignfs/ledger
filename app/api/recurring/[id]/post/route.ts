import { post } from '@/src/access/recurring-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// Posts an occurrence that waits to be confirmed (DESIGN.md §8.2). Another person's entry is not found, as one that never was.
export const dynamic = 'force-dynamic';

export const POST = bookRoute(async (context) => post(await getDatabase(), context));
