import { bookRoute } from '@/src/access/route';
import { read, write } from '@/src/access/setup-api';
import { getDatabase } from '@/src/db/boot';

// The setup wizard's steps (DESIGN.md §15.3), each a real write and safe to repeat. What each does is in `src/access/setup-api.ts`, tested as a second person.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) => read(await getDatabase(), context));
export const POST = bookRoute(async (context) => write(await getDatabase(), context));
