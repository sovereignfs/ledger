import { bookRoute } from '@/src/access/route';
import { bulk } from '@/src/access/transactions-api';
import { getDatabase } from '@/src/db/boot';

// Something done to several entries at once (DESIGN.md §6.9): marked cleared or pending, moved to another subcategory, deleted. Only the person's own are touched.
export const dynamic = 'force-dynamic';

export const POST = bookRoute(async (context) => bulk(await getDatabase(), context));
