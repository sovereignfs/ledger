import { bookRoute } from '@/src/access/route';
import { options } from '@/src/access/transactions-api';
import { getDatabase } from '@/src/db/boot';

// What the add dialog offers (DESIGN.md §14.4): the person's own accounts, subcategories and income sources.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => options(await getDatabase(), context));
