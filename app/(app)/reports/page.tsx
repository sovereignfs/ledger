import type { Metadata } from 'next';
import { requireBook } from '@/src/access/page';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Reports' };

/** A place the shell has, with nothing in it yet: task 8.1 builds it. */
export default async function Page() {
  await requireBook();
  return (
    <PageContainer>
      <PageHeader title="Reports" description="Looking back, month by month and year by year." />
      <EmptyState
        icon="activity"
        heading="No reports yet"
        description="This arrives with a later task of the roadmap."
      />
    </PageContainer>
  );
}
