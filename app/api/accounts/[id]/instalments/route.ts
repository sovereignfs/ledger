import { instalments } from '@/src/access/recurring-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// Makes a loan's instalment a recurring entry (DESIGN.md §8.3). Another person's loan is not found, as one that never was.
export const dynamic = 'force-dynamic';

export const POST = bookRoute(async (context) => instalments(await getDatabase(), context));
