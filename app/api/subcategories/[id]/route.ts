import { changeSubcategory, removeSubcategory } from '@/src/access/categories-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// One subcategory of the person's book (DESIGN.md §7.1). Another person's is not found, as one that never was.
export const dynamic = 'force-dynamic';

export const PATCH = bookRoute(async (context) => changeSubcategory(await getDatabase(), context));
export const DELETE = bookRoute(async (context) => removeSubcategory(await getDatabase(), context));
