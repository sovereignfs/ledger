import { figures } from '@/src/access/income-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// A month's income, budgeted and received (DESIGN.md §7.4), in the person's own book.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => figures(await getDatabase(), context));
