import { reconcileInfo, reconcileNow } from '@/src/access/accounts-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// Reconciling an account to its statement (DESIGN.md §6.4): what it would be compared with, and doing it. Another person's account is not found.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => reconcileInfo(await getDatabase(), context));
export const POST = bookRoute(async (context) => reconcileNow(await getDatabase(), context));
