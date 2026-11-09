import { download } from '@/src/access/portability-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { currentNotifier } from '@/src/notifications/server';

// The person's book as one file (DESIGN.md §16). What it does is in `src/access/portability-api.ts`, tested as a second person.
export const dynamic = 'force-dynamic';

export const GET = bookRoute(async (context) =>
  download(await getDatabase(), context, (await currentNotifier()).activity),
);
