import { bookRoute } from '@/src/access/route';
import { create } from '@/src/access/transactions-api';
import { getDatabase } from '@/src/db/boot';

// Writing an entry (DESIGN.md §6.2). What it does is in `src/access/transactions-api.ts`, so that it is tested as a second person.
export const dynamic = 'force-dynamic';

export const POST = bookRoute(async (context) => create(await getDatabase(), context));
