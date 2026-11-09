import { valueNow } from '@/src/access/accounts-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// Giving an investment or a property a value (DESIGN.md §6.6). Another person's account is not found.
export const dynamic = 'force-dynamic';

export const POST = bookRoute(async (context) => valueNow(await getDatabase(), context));
