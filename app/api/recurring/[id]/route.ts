import { change, remove } from '@/src/access/recurring-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// One recurring entry of the person's book (DESIGN.md §8). Another person's is not found, as one that never was.
export const dynamic = 'force-dynamic';

export const PATCH = bookRoute(async (context) => change(await getDatabase(), context));
export const DELETE = bookRoute(async (context) => remove(await getDatabase(), context));
