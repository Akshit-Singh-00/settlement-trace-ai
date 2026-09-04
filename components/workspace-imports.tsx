'use client';
import { useState } from 'react';
import Papa from 'papaparse';
import { FileImage, Upload, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  WorkspacePanel,
  type WorkspaceAction,
} from '@/components/workspace-shell';
import { workspaceApi as api } from '@/lib/workspace-client';
import type { CsvSource } from '@/lib/csv-import';

type Extracted = {
  transactionId: string | null;
  settlementId: string | null;
  bankReference: string | null;
  utr: string | null;
  amountMinor: number | null;
  currency: string | null;
  creditedAt: string | null;
  bankStatus: string | null;
  uncertainty: string;
};
type Review = {
  transaction_id: string;
  settlement_id: string;
  bank_reference: string;
  utr: string;
  amount: string;
  currency: string;
  credited_at: string;
  status: string;
};
export function WorkspaceImports({
  act,
  busy,
  onImported,
}: {
  act: WorkspaceAction;
  busy: boolean;
  onImported: () => Promise<void>;
}) {
  const [source, setSource] = useState<CsvSource>('gateway');
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<File | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [uncertainty, setUncertainty] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [stripeResult, setStripeResult] = useState('');
  return (
    <>
      <div className="ws-heading">
        <div>
          <span className="ws-eyebrow">BUILD THE EVIDENCE TRAIL</span>
          <h1>Sources & imports.</h1>
          <p>Save source records once. Investigate them together.</p>
        </div>
      </div>
      <div className="ws-import-grid">
        <WorkspacePanel title="Upload a source CSV">
          <Upload className="ws-feature-icon" />
          <p>
            Import up to 1,000 rows and 1 MB per file. Matching source
            references update existing records. The workspace supports 10,000
            source records.
          </p>
          <form
            className="ws-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                if (!file) throw new Error('Choose a CSV file.');
                if (file.size > 1_000_000)
                  throw new Error('Choose a CSV under 1 MB.');
                const data = await api<{ count: number }>('imports', 'POST', {
                  source,
                  csv: await file.text(),
                });
                await onImported();
                setStripeResult(`${data.count} ${source} records imported.`);
              }, 'Source records saved.');
            }}
          >
            <label>
              Source system
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as CsvSource)}
              >
                {['gateway', 'settlement', 'bank', 'ledger'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="ws-file" htmlFor="workspace-imports-1">
              CSV file
              <Input
                id="workspace-imports-1"
                type="file"
                accept=".csv,text/csv"
                required
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            <small>
              Amounts are integer minor units (₹100 = 10000). IDs must use TXN-…
              and SET-… prefixes.
            </small>
            <Button type="submit" disabled={busy || !file}>
              Validate & import
            </Button>
          </form>
          <div className="ws-template-links">
            Templates:{' '}
            {['gateway', 'settlement', 'bank', 'ledger'].map((s) => (
              <a key={s} href={`/templates/${s}.csv`} download>
                {s}
              </a>
            ))}
          </div>
        </WorkspacePanel>
        <WorkspacePanel title="Stripe sandbox">
          <Zap className="ws-feature-icon" />
          <span className="ws-badge">TEST DATA</span>
          <p>
            Pull successful capture events from the last 30 days. Import gateway
            evidence, then add settlement, bank, and ledger evidence from their
            own sources.
          </p>
          <div className="ws-notice">
            <strong>Match the same transaction across systems</strong>
            <p>
              Set Stripe charge metadata <code>transaction_id</code> to your
              TXN-… ID. Otherwise the importer assigns a TXN-STRIPE-… ID.
            </p>
          </div>
          <Button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const result = await api<{ count: number; message: string }>(
                  'stripe',
                  'POST',
                );
                setStripeResult(
                  `${result.count} records imported. ${result.message}`,
                );
                await onImported();
              }, 'Stripe sandbox sync complete.')
            }
          >
            <RefreshIcon /> Sync sandbox captures
          </Button>
          <small>
            Your Admin can check the connection in Administration. Only sandbox
            keys are accepted.
          </small>
        </WorkspacePanel>
      </div>
      {stripeResult && (
        <div className="ws-success" aria-live="polite">
          {stripeResult}
        </div>
      )}
      <WorkspacePanel title="Read bank evidence from a document">
        <div className="ws-document-intro">
          <FileImage className="ws-feature-icon" />
          <div>
            <p>
              Extract fields from a bank PDF or screenshot with Gemini, then
              verify each field before importing.
            </p>
            <small>
              PDF, PNG, JPEG or WebP · 2 MB maximum · The selected document is
              sent to Gemini for extraction.
            </small>
          </div>
        </div>
        <form
          className="ws-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              if (!document) throw new Error('Choose a document.');
              if (document.size > 2_000_000)
                throw new Error('Choose a document under 2 MB.');
              setReview(null);
              setConfirmed(false);
              const data = await fileBase64(document);
              const { evidence: x } = await api<{ evidence: Extracted }>(
                'extract',
                'POST',
                { mimeType: document.type, data },
              );
              setReview({
                transaction_id: x.transactionId || '',
                settlement_id: x.settlementId || '',
                bank_reference: x.bankReference || '',
                utr: x.utr || '',
                amount: x.amountMinor?.toString() || '',
                currency: x.currency || '',
                credited_at: x.creditedAt || '',
                status: x.bankStatus || '',
              });
              setUncertainty(x.uncertainty);
            }, 'Extraction ready for your review.');
          }}
        >
          <label htmlFor="workspace-imports-2">
            Bank document
            <Input
              id="workspace-imports-2"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              required
              onChange={(e) => {
                setDocument(e.target.files?.[0] || null);
                setReview(null);
                setConfirmed(false);
              }}
            />
          </label>
          <Button type="submit" disabled={busy || !document}>
            Extract for review
          </Button>
        </form>
        {review && (
          <form
            className="ws-form ws-review"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                if (!confirmed)
                  throw new Error(
                    'Verify the extracted fields before importing.',
                  );
                if (
                  !/^\d+$/.test(review.amount) ||
                  !Number.isSafeInteger(Number(review.amount)) ||
                  Number(review.amount) <= 0
                )
                  throw new Error(
                    'Amount must be a positive integer in minor units.',
                  );
                await api('imports', 'POST', {
                  source: 'bank',
                  csv: Papa.unparse([review]),
                });
                setReview(null);
                setConfirmed(false);
                await onImported();
              }, 'Reviewed bank evidence imported.');
            }}
          >
            <div className="ws-notice">
              <strong>Human review required</strong>
              <p>
                {uncertainty ||
                  'Check every field against the original document. Fill any missing values from verified source evidence.'}
              </p>
            </div>
            <div className="ws-form-grid">
              {Object.entries(review).map(([key, value]) => (
                <label key={key} htmlFor={`ws-input-${key}`}>
                  {key.replaceAll('_', ' ')}
                  {key === 'status' ? (
                    <select
                      required
                      value={value}
                      onChange={(e) => {
                        setReview({ ...review, status: e.target.value });
                        setConfirmed(false);
                      }}
                    >
                      <option value="">Choose…</option>
                      <option>credited</option>
                      <option>pending</option>
                      <option>failed</option>
                    </select>
                  ) : (
                    <Input
                      id={`ws-input-${key}`}
                      required={
                        key !== 'utr' &&
                        (key !== 'credited_at' || review.status === 'credited')
                      }
                      placeholder={
                        key === 'credited_at'
                          ? '2026-09-05T10:00:00+05:30'
                          : key === 'amount'
                            ? 'Integer minor units'
                            : ''
                      }
                      value={value}
                      onChange={(e) => {
                        setReview({ ...review, [key]: e.target.value });
                        setConfirmed(false);
                      }}
                    />
                  )}
                </label>
              ))}
            </div>
            <label className="ws-check">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I verified these fields against the original evidence.
            </label>
            <Button type="submit" disabled={busy || !confirmed}>
              Import reviewed bank record
            </Button>
          </form>
        )}
      </WorkspacePanel>
    </>
  );
}
function RefreshIcon() {
  return <Zap size={15} />;
}
function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read the file.'));
    reader.onload = () =>
      resolve(
        (typeof reader.result === 'string' ? reader.result : '').split(',')[1],
      );
    reader.readAsDataURL(file);
  });
}
