import type { Metadata } from 'next';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Overview' };

/** A place the shell has, with nothing in it yet: task 9.2 builds it. */
export default function Page() {
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
