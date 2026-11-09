import { bookRoute } from '@/src/access/route';
import { change, read, remove } from '@/src/access/transactions-api';
import { getDatabase } from '@/src/db/boot';

// One entry of the person's book (DESIGN.md §6.2). Another person's is not found, as one that never was.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => read(await getDatabase(), context));
export const PATCH = bookRoute(async (context) => change(await getDatabase(), context));
export const DELETE = bookRoute(async (context) => remove(await getDatabase(), context));
