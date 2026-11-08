import { requireBook } from '@/src/access/page';
import { AccountDialog } from '@/src/account/AccountDialog';
import { AccountPanel } from '@/src/account/AccountPanel';
import { one } from '@/src/account/query';

/** `/account` opened from another page of the app: the same Settings, as a dialog over that page. A refresh or a typed address is `app/(app)/account`. */
export default async function AccountModal({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireBook();
  const query = await searchParams;
  return (
    <AccountDialog>
      <AccountPanel query={{ section: one(query.section) }} />
    </AccountDialog>
  );
}
