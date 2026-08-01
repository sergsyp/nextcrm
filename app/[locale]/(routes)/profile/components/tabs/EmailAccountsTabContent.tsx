import {
  getEmailAccounts,
  getEmailDelegateCandidates,
} from "@/actions/emails/accounts";
import { EmailAccountsList } from "../EmailAccountsList";

export async function EmailAccountsTabContent() {
  const [accounts, delegateCandidates] = await Promise.all([
    getEmailAccounts(),
    getEmailDelegateCandidates(),
  ]);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold text-card-foreground">
          Email Accounts
        </h3>
        <EmailAccountsList
          accounts={accounts}
          delegateCandidates={delegateCandidates}
        />
      </div>
    </div>
  );
}
