import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireBook } from '@/src/access/page';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Overview' };

/** The front address for someone signed in. A book that is not set up is taken to the wizard from here (DESIGN.md §15.3); Overview itself is task 9.2. */
export default async function Page() {
  const { book } = await requireBook();
  if (book.setupDoneAt === null) redirect('/setup');
  return (
    <PageContainer>
      <PageHeader title="Overview" description="Where things stand, at a glance." />
      <EmptyState
        icon="house"
        heading="Nothing to show yet"
        description="This arrives with a later task of the roadmap."
      />
    </PageContainer>
  );
}
