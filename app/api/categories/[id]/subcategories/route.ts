import { addSubcategory } from '@/src/access/categories-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// A subcategory made in a category of the person's book (DESIGN.md §7.1).
export const dynamic = 'force-dynamic';

export const POST = bookRoute(async (context) => addSubcategory(await getDatabase(), context));
