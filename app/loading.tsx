import { Spinner } from '@sovereignfs/ui';

export default function Loading() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
      <Spinner size="lg" label="Loading" />
    </div>
  );
}
