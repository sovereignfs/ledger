import type { Metadata } from 'next';
import Link from 'next/link';
import { requireBook } from '@/src/access/page';
import { listCategories } from '@/src/budget/categories';
import { CategoriesManager } from '@/src/budget/CategoriesManager';
import { getDatabase } from '@/src/db/boot';
import { PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Categories' };

/** Categories and subcategories (DESIGN.md §7.1): what expenses are labelled with, and what a budget is set for. */
export default async function Page() {
  const { accountId, book } = await requireBook();
  const categories = await listCategories(await getDatabase(), accountId, book.id);
  return (
    <PageContainer>
      <PageHeader title="Categories" description="What expenses are labelled with." />
      <p>
        <Link href="/budget">Back to the budget</Link>
      </p>
      <CategoriesManager categories={categories} baseCurrency={book.baseCurrency} />
    </PageContainer>
  );
}
