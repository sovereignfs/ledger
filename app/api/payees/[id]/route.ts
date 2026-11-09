import { change, read } from '@/src/access/payees-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// One payee of the person's book (DESIGN.md §6.5). Another person's is not found, as one that never was.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => read(await getDatabase(), context));
export const PATCH = bookRoute(async (context) => change(await getDatabase(), context));
