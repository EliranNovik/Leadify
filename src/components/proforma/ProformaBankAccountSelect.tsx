import React from 'react';
import {
  type BankAccountRecord,
  type BankAccountSnapshot,
  toBankAccountSnapshot,
} from '../../lib/bankAccounts';

type Props = {
  accounts: BankAccountRecord[];
  loading?: boolean;
  value: string;
  onChange: (accountId: string, snapshot: BankAccountSnapshot | null) => void;
};

const ProformaBankAccountSelect: React.FC<Props> = ({ accounts, loading, value, onChange }) => {
  return (
    <div className="form-control">
      <label className="label">
        <span className="label-text font-medium">Bank Account</span>
      </label>
      <select
        className="select select-bordered w-full"
        value={value}
        disabled={loading}
        onChange={(e) => {
          const accountId = e.target.value;
          const account = accounts.find((a) => a.id === accountId);
          onChange(accountId, account ? toBankAccountSnapshot(account) : null);
        }}
      >
        <option value="">{loading ? 'Loading accounts…' : 'Select account…'}</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
            {account.account_number ? ` — ${account.account_number}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
};

export default ProformaBankAccountSelect;
