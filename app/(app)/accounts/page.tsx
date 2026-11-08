import type { Metadata } from 'next';
import { requireBook } from '@/src/access/page';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Accounts' };

/** A place the shell has, with nothing in it yet: task 4.1 builds it. */
export default async function Page() {
  await requireBook();
  return (
    <PageContainer>
      <PageHeader title="Accounts" description="What you have, what you owe, what you are worth." />
      <EmptyState
        icon="credit-card"
        heading="No accounts yet"
        description="This arrives with a later task of the roadmap."
      />
    </PageContainer>
  );
}
