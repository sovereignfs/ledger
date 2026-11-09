import Link from 'next/link';
import styles from './Account.module.css';

/**
 * Settings, Budget (DESIGN.md §15.1): where the parts of the budget that setup made are looked after. They have pages of their own, since they are used there as well as set up
 * here, so this says where each is.
 */
export function BudgetSection() {
  return (
    <div className={styles.group}>
      <h2>Budget</h2>
      <ul>
        <li>
          <Link href="/budget/income">Income sources</Link>: what comes in, with its budget and
          history.
        </li>
        <li>
          <Link href="/budget/categories">Categories</Link>: make, order, archive and delete them
          and their subcategories.
        </li>
        <li>
          <Link href="/payees">Payees</Link>: rename, merge and archive who you pay.
        </li>
      </ul>
    </div>
  );
}
