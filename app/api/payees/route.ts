import { list } from '@/src/access/payees-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// The payees of the person's book (DESIGN.md §6.5), and what the autocomplete asks as a person types.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => list(await getDatabase(), context));
