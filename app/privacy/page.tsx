import { PolicyPage } from '@/components/policy-page';
export const metadata = { title: 'Privacy policy | Settlement Trace AI' };
export default function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy policy"
      intro="How this project uses account information and settlement evidence."
    >
      <section>
        <h2>Account information</h2>
        <p>
          Google sign-in provides your verified email address, name, profile
          picture, and account identifier. The workspace uses these to identify
          invited members, apply their role, and attribute actions. It requests
          basic identity and profile access. The application does not receive
          your Google password or request access to Gmail, Drive, or contacts.
        </p>
      </section>
      <section>
        <h2>Workspace records</h2>
        <p>
          Supabase stores member profiles and preferences, imported source
          records, case assignments, notes, mentions, scan summaries, and
          activity logs. These records are shared with authorized members of
          this workspace according to their roles. Administrators manage
          invitations and access. Mentions record references to other members;
          they do not send email.
        </p>
        <p>
          Session cookies keep you signed in. Theme preferences and synthetic
          demo records may be stored in your browser. Logging out ends your
          application session; it does not delete shared records or audit
          history.
        </p>
      </section>
      <section>
        <h2>AI and connected services</h2>
        <p>
          When you request an AI investigation, the application sends the
          structured investigation result to Google Gemini to generate an
          explanation. When you choose “Extract for review,” it sends the
          selected PDF or image to Gemini. The application does not persist the
          original uploaded document; reviewed fields are saved only after an
          import is confirmed.
        </p>
        <p>
          Stripe synchronization reads captured sandbox charge events and
          associated transaction metadata. Vercel hosts the website and
          processes requests. Supabase provides authentication and database
          storage. These providers process information under their own policies.
          Their infrastructure may retain service or security logs independently
          of the application.
        </p>
        <p>
          External alert delivery is optional and currently disabled. If an
          administrator enables it, transaction identifiers, stages, and root
          causes are sent to the configured destination. Exceptions remain
          visible inside the website.
        </p>
      </section>
      <section>
        <h2>Your choices and data removal</h2>
        <p>
          Edit your display name, profile picture, theme, timezone, and
          preferred view from My profile. You can revoke Google sign-in access
          in your Google Account connections. For deletion of stored workspace
          information, contact the administrator. There is no automatic
          retention period configured, and shared records or audit entries are
          not deleted when an account is deactivated.
        </p>
        <p>
          Upload only information you are authorized to share with workspace
          members and the relevant service providers. Use synthetic or sandbox
          data for demonstrations, and do not upload payment-card details,
          passwords, or API keys.
        </p>
      </section>
    </PolicyPage>
  );
}
