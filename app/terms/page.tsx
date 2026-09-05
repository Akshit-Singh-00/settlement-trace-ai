import { PolicyPage } from '@/components/policy-page';
import Link from 'next/link';
export const metadata = { title: 'Terms of use | Settlement Trace AI' };
export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms of use"
      intro="Use the evidence workspace responsibly and review findings before acting."
    >
      <section>
        <h2>Project purpose</h2>
        <p>
          Settlement Trace AI is an academic project for investigating
          settlement records. The public demo uses synthetic data. The protected
          workspace supports invited teams, uploaded evidence, and Stripe
          sandbox events. Its connector does not initiate payments, refunds, or
          payouts.
        </p>
      </section>
      <section>
        <h2>Accounts and shared access</h2>
        <p>
          Use your own invited Google account. Administrators assign Viewer,
          Investigator, or Admin access and may deactivate membership. Keep
          credentials private and report unexpected access to the administrator.
          Imported records and case notes are shared workspace information, not
          a private personal notebook.
        </p>
      </section>
      <section>
        <h2>Authorized data and conduct</h2>
        <p>
          Submit only records you are permitted to use and disclose to the
          workspace and connected services. Use test data for sandbox
          demonstrations. Do not upload secrets or payment-card details,
          impersonate another member, attempt to bypass access controls, or
          disrupt the service.
        </p>
      </section>
      <section>
        <h2>Review before action</h2>
        <p>
          Reconciliation findings depend on the completeness and accuracy of
          supplied records and configured settlement windows. AI explanations
          and document extraction can contain mistakes. Verify results against
          original source evidence before making an operational decision.
          Marking a case resolved records a workflow decision; it does not
          change the source evidence or move money.
        </p>
      </section>
      <section>
        <h2>Availability and limits</h2>
        <p>
          This project runs on hosted services with quotas and availability
          limits. Scheduled scans run daily, rather than continuously. Imports
          accept up to 1,000 rows per file and the workspace supports 10,000
          source records. Keep your original records and use your source systems
          to confirm transaction status.
        </p>
      </section>
      <section>
        <h2>Privacy and updates</h2>
        <p>
          The <Link href="/privacy">privacy policy</Link> describes account
          information, shared records, and connected services. This page may be
          updated as the project changes; its date identifies the current
          version.
        </p>
      </section>
    </PolicyPage>
  );
}
