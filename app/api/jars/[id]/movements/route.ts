import { movement } from '@/src/access/jars-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// Earmarks money in a jar or releases some (DESIGN.md §10.2). Another person's jar is not found, as one that never was.
export const dynamic = 'force-dynamic';

export const POST = bookRoute(async (context) => movement(await getDatabase(), context));
