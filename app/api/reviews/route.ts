import { list, mark } from '@/src/access/reviews-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// The months the person's book has reviewed (DESIGN.md §11.4). What each does is in `src/access/reviews-api.ts`, tested as a second person.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => list(await getDatabase(), context));
export const POST = bookRoute(async (context) => mark(await getDatabase(), context));
