import type { Metadata } from 'next';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Transactions' };

/** A place the shell has, with nothing in it yet: task 4.7 builds it. */
export default function Page() {
  return (
    <PageContainer>
      <PageHeader title="Transactions" description="Every entry, findable." />
      <EmptyState
        icon="list"
        heading="No transactions yet"
        description="This arrives with a later task of the roadmap."
      />
    </PageContainer>
  );
}
