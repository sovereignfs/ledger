import { change, read, remove } from '@/src/access/accounts-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// One account of the person's book (DESIGN.md §6.1). Another person's is not found, as one that never was.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => read(await getDatabase(), context));
export const PATCH = bookRoute(async (context) => change(await getDatabase(), context));
export const DELETE = bookRoute(async (context) => remove(await getDatabase(), context));
