import { change } from '@/src/access/jars-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// One jar of the person's book (DESIGN.md §10). Another person's is not found, as one that never was.
export const dynamic = 'force-dynamic';

export const PATCH = bookRoute(async (context) => change(await getDatabase(), context));
