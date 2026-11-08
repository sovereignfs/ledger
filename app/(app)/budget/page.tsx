import type { Metadata } from 'next';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Budget' };

/** A place the shell has, with nothing in it yet: task 5.4 builds it. */
export default function Page() {
  return (
    <PageContainer>
      <PageHeader title="Budget" description="Budgeted and spent, month by month." />
      <EmptyState
        icon="sliders-horizontal"
        heading="No budget yet"
        description="This arrives with a later task of the roadmap."
      />
    </PageContainer>
  );
}
