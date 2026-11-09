'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Dialog, FormField, Input, Select } from '@sovereignfs/ui';
import { ACCOUNT_KINDS, ACCOUNT_TYPES, type AccountType } from '../ledger/account-types';
import { CurrencyPicker } from '../ui/CurrencyPicker';
import { MoneyInput } from '../ui/MoneyInput';
import styles from './Accounts.module.css';

type Owing = 'owes_me' | 'i_owe';

/**
 * Add an account (DESIGN.md §6.1, §6.4): its kind, name and currency, and what is in it on a day, which becomes its opening balance. **A person types what is
 * owed as an amount, not as a minus**: for a card or a loan it is "owed now", and for a person it is who owes whom; the sign is made here, once, and the
 * server is sent a balance. The currency of an account cannot be changed afterwards, which the dialog says before it is chosen.
 */
export function NewAccountButton({
  defaultCurrency,
  today,
}: {
  defaultCurrency: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AccountType>('bank');
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [owing, setOwing] = useState<Owing>('owes_me');
  const [limit, setLimit] = useState<number | null>(null);
  const [lender, setLender] = useState('');
  const [principal, setPrincipal] = useState<number | null>(null);
  const [instalment, setInstalment] = useState<number | null>(null);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState('');
  const [rate, setRate] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  const side = ACCOUNT_KINDS[type].side;
  const owedLabel = type === 'loan' ? 'Still owed today' : 'Owed now';

  /** What is in the account, as a balance: owed money is below nothing. */
  function balance(): number | null {
    if (type === 'loan') return -(amount ?? principal ?? 0);
    if (amount === null) return null;
    if (side === 'liability') return -amount;
    if (type === 'person') return owing === 'owes_me' ? amount : -amount;
    return amount;
  }

  async function submit() {
    setWorking(true);
    setProblems([]);
    const opening = balance();
    const body = {
      type,
      name,
      institution: institution.trim() === '' ? null : institution,
      currency,
      ...(type === 'credit_card' && limit !== null ? { creditLimit: limit } : {}),
      ...(opening !== null && opening !== 0 ? { opening: { amount: opening, date } } : {}),
      ...(type === 'loan'
        ? {
            loan: {
              lender,
              principal: principal ?? 0,
              instalment: instalment ?? 0,
              startDate: start,
              endDate: end,
              yearlyRate: rate.trim() === '' ? null : rate.trim(),
              interestSubcategoryId: null,
            },
          }
        : {}),
    };
    try {
      const reply = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (reply.status === 201) {
        const { id } = (await reply.json()) as { id: string };
        setOpen(false);
        router.push(`/accounts/${id}`);
        router.refresh();
        return;
      }
      const data = (await reply.json().catch(() => ({}))) as { problems?: string[] };
      setProblems(data.problems ?? ['That could not be added. Try again.']);
    } catch {
      setProblems(['That needs a connection.']);
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add account</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add account"
        aria-label="Add account"
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {problems.length > 0 ? (
            <Alert variant="error">
              {problems.map((problem) => (
                <span key={problem} style={{ display: 'block' }}>
                  {problem}
                </span>
              ))}
            </Alert>
          ) : null}
          <FormField label="Kind" hint={ACCOUNT_KINDS[type].hint}>
            {(field) => (
              <Select
                {...field}
                value={type}
                onChange={(event) => setType(event.target.value as AccountType)}
              >
                {ACCOUNT_TYPES.map((each) => (
                  <option key={each} value={each}>
                    {ACCOUNT_KINDS[each].label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Name" required>
            {(field) => (
              <Input
                {...field}
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Institution"
            hint="Optional: the bank or lender. Never an account number."
          >
            {(field) => (
              <Input
                {...field}
                value={institution}
                maxLength={80}
                onChange={(event) => setInstitution(event.target.value)}
              />
            )}
          </FormField>
          <FormField label="Currency" hint="It cannot be changed once the account is made.">
            {(field) => <CurrencyPicker {...field} value={currency} onChange={setCurrency} />}
          </FormField>
          {type === 'credit_card' ? (
            <FormField label="Credit limit">
              {(field) => (
                <MoneyInput
                  {...field}
                  currency={currency}
                  valueCents={limit}
                  onValueChange={setLimit}
                />
              )}
            </FormField>
          ) : null}
          {type === 'loan' ? (
            <>
              <FormField label="Lender" required>
                {(field) => (
                  <Input
                    {...field}
                    value={lender}
                    maxLength={80}
                    onChange={(event) => setLender(event.target.value)}
                  />
                )}
              </FormField>
              <div className={styles.two}>
                <FormField label="Borrowed" required>
                  {(field) => (
                    <MoneyInput
                      {...field}
                      currency={currency}
                      valueCents={principal}
                      onValueChange={setPrincipal}
                    />
                  )}
                </FormField>
                <FormField label="Each instalment" required>
                  {(field) => (
                    <MoneyInput
                      {...field}
                      currency={currency}
                      valueCents={instalment}
                      onValueChange={setInstalment}
                    />
                  )}
                </FormField>
                <FormField label="Started" required>
                  {(field) => (
                    <Input
                      {...field}
                      type="date"
                      value={start}
                      onChange={(event) => setStart(event.target.value)}
                    />
                  )}
                </FormField>
                <FormField label="Ends" required>
                  {(field) => (
                    <Input
                      {...field}
                      type="date"
                      value={end}
                      onChange={(event) => setEnd(event.target.value)}
                    />
                  )}
                </FormField>
              </div>
              <FormField label="Yearly interest, in percent" hint="Optional, such as 4.25.">
                {(field) => (
                  <Input
                    {...field}
                    inputMode="decimal"
                    value={rate}
                    onChange={(event) => setRate(event.target.value)}
                  />
                )}
              </FormField>
            </>
          ) : null}
          {type === 'person' ? (
            <FormField label="Who owes whom">
              {(field) => (
                <Select
                  {...field}
                  value={owing}
                  onChange={(event) => setOwing(event.target.value as Owing)}
                >
                  <option value="owes_me">They owe me</option>
                  <option value="i_owe">I owe them</option>
                </Select>
              )}
            </FormField>
          ) : null}
          <div className={styles.two}>
            <FormField
              label={
                side === 'liability' ? owedLabel : type === 'person' ? 'Amount' : 'What is in it'
              }
              hint={
                type === 'loan' ? 'Leave empty if it is all of what was borrowed.' : 'Optional.'
              }
            >
              {(field) => (
                <MoneyInput
                  {...field}
                  currency={currency}
                  valueCents={amount}
                  onValueChange={setAmount}
                />
              )}
            </FormField>
            <FormField label="On" hint="The day that amount is of.">
              {(field) => (
                <Input
                  {...field}
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              )}
            </FormField>
          </div>
          <div className={styles.actions}>
            <Button type="submit" disabled={working || name.trim() === ''}>
              {working ? 'Adding…' : 'Add account'}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
