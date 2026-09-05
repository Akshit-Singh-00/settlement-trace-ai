# Team workspace

The public synthetic demo remains at [the live site](https://settlement-trace-ai.vercel.app). The protected operations workspace lives at `/workspace`; `/login`, `/settings`, and `/admin` are its entry points.

## Database and authentication

Apply `supabase/migrations/202609050001_workspace.sql` once to a fresh Supabase PostgreSQL project. It creates nine tables and six server-only functions. Every table has RLS enabled and browser roles have no table privileges. Supabase's server HTTP API avoids requiring a persistent PostgreSQL socket in Vercel or Cloudflare.

Configure the following **server** environment variables. None should use a `NEXT_PUBLIC_` prefix.

| Variable                         | Purpose                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `SUPABASE_URL`                   | Supabase project URL                                                           |
| `SUPABASE_PUBLISHABLE_KEY`       | Publishable key used for Auth                                                  |
| `SUPABASE_SERVICE_ROLE_KEY`      | Secret API key (or legacy service-role key), stored only on the server         |
| `APP_URL`                        | Exact canonical origin; production is `https://settlement-trace-ai.vercel.app` |
| `WORKSPACE_ADMIN_EMAIL`          | Verified Google email permitted to bootstrap the first Admin                   |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional evidence-grounded explanations and document extraction                |
| `STRIPE_SECRET_KEY`              | Optional Stripe **sandbox** key beginning `sk_test_`                           |
| `CRON_SECRET`                    | Random secret authorizing the Vercel daily job                                 |
| `ALERT_WEBHOOK_URL`              | Optional operator-managed HTTPS webhook endpoint                               |

For this deployment the designated Admin is `khush227799@gmail.com`. Other accounts require an Admin-created invitation matching their Google email. Inviting grants membership; it does not send an email. Only a verified Google identity may use the workspace. Password or unverified email sessions are rejected.

Google sign-in is connected for the live Vercel workspace and the designated Admin has completed a real sign-in. The OAuth client is named **Settlement Trace AI — Vercel** in Google Cloud project `angular-pursuit-499402-n2`. Supabase uses the live site as its site URL and allows `https://settlement-trace-ai.vercel.app/auth/callback`. Public privacy and usage information is available at `/privacy` and `/terms`.

Create a Google OAuth **Web application** client and enable Google in Supabase Authentication → Sign In / Providers. The Google authorized redirect URI is the project's `https://<project-ref>.supabase.co/auth/v1/callback`. Set Supabase's site URL to `APP_URL` and allow `APP_URL/auth/callback`. During Google OAuth testing, add the invited Google emails as test users. Publish the OAuth app when ready for broader sign-in. Local development may separately allow `http://localhost:4173/auth/callback`.

The server performs the PKCE exchange, verifies identity with `getUser()`, then checks the active database membership on every request. Session cookies are HttpOnly, SameSite=Lax and Secure in production. Authenticated responses are private/no-store. Mutations require the exact configured Origin. Database-backed write and expensive-operation limits fail closed if they cannot be checked.

## Roles and workflow

| Role         | Allowed actions                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Viewer       | Read dashboard, results, evidence, case status and notes; edit own profile                                                      |
| Investigator | Viewer actions plus trace, CSV import, Stripe sync, PDF/image extraction, scan, report export, case assignment/status and notes |
| Admin        | Investigator actions plus invitations, role/access changes, SLAs and audit access                                               |

The server checks every permission; hiding a control is only a UI convenience. Profile updates reject unknown fields, including role, email and identity. The member-update function prevents self-lockout and removal of the last Admin. Deactivated members lose API access on their next request.

Search transaction IDs, merchants and root causes; filter by result, exception type and captured date in the profile timezone. Sort by time, amount or confidence. Up to 100 selected transactions can receive a case status update. A reconciliation result and a case's workflow status are separate: marking a case Resolved does not change the source evidence or engine findings. Scans preserve existing assignments and statuses.

Notes support recorded `@email` mentions and HTTPS reference links. Mentions do not send notifications. Display name, photo URL, theme, timezone and default dashboard persist in PostgreSQL. Audit events record sign-ins, profile changes, traces, imports, reports, scans, notes, case changes and administration.

## Source records and limits

Download header templates from `/templates/gateway.csv`, `/templates/settlement.csv`, `/templates/bank.csv`, and `/templates/ledger.csv`. Use ISO timestamps, `TXN-…` transaction IDs and `SET-…` settlement IDs. Amounts use integer minor units. Use the same references across source systems.

An import accepts at most 1 MB and 1,000 rows; the workspace accepts 10,000 source records. Imports are transactional upserts by source reference, preserve records from other sources, and record provenance. They are shared workspace data. The public demo's browser-local synthetic records are never silently imported.

Stripe reads captured sandbox charge events from the last 30 days, up to 1,000 events per sync. It rejects live keys and ignores uncaptured or unsupported-currency events. Supported currencies are INR, USD, EUR, GBP, CAD, AUD, SGD, NZD, AED and CHF. Put your `TXN-…` ID in charge metadata `transaction_id`; otherwise a stable `TXN-STRIPE-…` ID is assigned. Stripe provides gateway evidence only. Bank, settlement and merchant-ledger records must come from their corresponding sources. The connector does not initiate payments, refunds or payouts.

Document extraction accepts PDF, PNG, JPEG or WebP up to 2 MB. Gemini returns explicit fields with nulls for missing or ambiguous values. The reviewer must verify the original evidence, fill required fields and confirm before importing a bank row. The original document is not stored. Scanned documents may still need manual entry.

## Scheduled operations

`/api/jobs/daily` runs once daily at `02:00 UTC` on Vercel's free plan. It requires `Authorization: Bearer <CRON_SECRET>`. If Stripe sandbox is configured, it syncs captures before scanning; a Stripe failure is audited and does not prevent the scan. A summary is saved for Overview. This is a daily schedule, not real-time event processing.

Exceptions and their counts are always available inside the workspace. This deployment currently uses the website for exception review; an external notification destination is optional.

To add external notifications, configure a webhook and enable daily SLA alerts in Administration. Delayed stages beyond the configured threshold are queued, deduplicated by transaction/stage/cause, and sent in batches of ten. Delivery uses a two-minute claim and at most five attempts; successful deliveries are marked once. Failed delivery can be retried by a later daily job. Disabling alerts stops delivery. Webhook payloads contain transaction ID, stage and root cause; configure a destination authorized to receive that workspace data. Native Slack setup and continuous workers are not included; a compatible webhook can forward notifications.

## Verification

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm test:e2e`, `pnpm build`, and `pnpm build:vercel`. Browser tests use isolated API fixtures and do not replace real Google sign-in verification.

With ignored local credentials configured, `node scripts/workspace-check.mjs` checks actual tables, public-access denial, RPC availability and Google provider status without printing secrets or rows. `node scripts/workspace-integration-check.mjs` creates UUID-scoped temporary fixtures, exercises database role checks, persistence and idempotency, case preservation and rate limits, then removes only those fixtures. Run against a development project whenever available.

Google sign-in, real Stripe sandbox ingestion, Gemini document quality, and external webhook delivery must each be verified with their configured service. A UI label of Configured indicates that credentials are present, not that a successful service call has occurred.

References: [Supabase Google Auth](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Stripe events](https://docs.stripe.com/api/events/list), [Gemini documents](https://ai.google.dev/gemini-api/docs/document-processing), [Vercel cron limits](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
