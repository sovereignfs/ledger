import { addBookCurrency } from '@/src/access/book-api';
import { bookRoute } from '@/src/access/route';
import { getDatabase } from '@/src/db/boot';

// Adds a currency to the person's book (DESIGN.md §9.2, §15.1). Nothing in a request names whose book.
export const dynamic = 'force-dynamic';

export const POST = bookRoute(async (context) => addBookCurrency(await getDatabase(), context));
