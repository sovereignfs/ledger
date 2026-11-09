import { upload } from '@/src/access/portability-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';
import { currentNotifier } from '@/src/notifications/server';

// A file imported into the person's own book, if it is empty (DESIGN.md §16). What it does is in `src/access/portability-api.ts`.
export const dynamic = 'force-dynamic';

export const POST = bookRoute(async (context) =>
  upload(await getDatabase(), context, (await currentNotifier()).activity),
);
