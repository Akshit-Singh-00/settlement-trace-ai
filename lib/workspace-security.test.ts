import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canAccess,
  rolePermissions,
  defaultWorkspaceSettings,
} from './workspace-types';
import {
  profileSchema,
  noteSchema,
  settingsSchema,
  bulkCaseSchema,
} from './workspace-validation';
import {
  checkOrigin,
  readJson,
  requireMember,
  authContext,
} from './server/workspace-auth';
import { stripeEventToGateway } from './server/stripe-connector';
import { extractDocument } from './server/document-extraction';
import { reconcileTransaction } from './reconciliation';
import { buildSandboxData } from './sandbox-data';

afterEach(() => vi.unstubAllEnvs());
describe('workspace access boundaries', () => {
  it('limits Viewers to reading and denies Investigator administration', () => {
    for (const permission of rolePermissions.admin)
      expect(canAccess('viewer', permission)).toBe(permission === 'read');
    expect(canAccess('investigator', 'admin')).toBe(false);
    expect(canAccess('investigator', 'import')).toBe(true);
  });
  it('rejects profile role escalation, identity changes, unsafe links, and invalid preferences', () => {
    const profile = {
      display_name: 'Akshit Singh',
      avatar_url: '',
      theme: 'dark',
      timezone: 'Asia/Kolkata',
      default_view: 'overview',
    };
    expect(profileSchema.safeParse(profile).success).toBe(true);
    for (const extra of [
      { role: 'admin' },
      { auth_user_id: 'attacker' },
      { email: 'other@example.com' },
      { timezone: 'Mars/Olympus' },
      { avatar_url: 'javascript:alert(1)' },
    ])
      expect(profileSchema.safeParse({ ...profile, ...extra }).success).toBe(
        false,
      );
    expect(
      noteSchema.safeParse({
        body: 'note',
        reference_url: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({
        ...defaultWorkspaceSettings,
        bank_sla_minutes: 0,
      }).success,
    ).toBe(false);
    expect(
      bulkCaseSchema.safeParse({
        transactionIds: Array(101).fill('TXN-1000'),
        status: 'resolved',
      }).success,
    ).toBe(false);
  });
  it('rejects cross-origin and missing-origin mutations', () => {
    vi.stubEnv('APP_URL', 'https://workspace.example');
    for (const origin of [
      'https://evil.example',
      'https://workspace.example.evil.test',
      'null',
      '',
    ])
      expect(() =>
        checkOrigin(
          new Request('https://workspace.example/api/workspace/profile', {
            method: 'PATCH',
            headers: origin ? { origin } : {},
          }),
        ),
      ).toThrow('workspace website');
    expect(() =>
      checkOrigin(
        new Request('https://workspace.example/api/workspace/profile', {
          method: 'PATCH',
          headers: { origin: 'https://workspace.example' },
        }),
      ),
    ).not.toThrow();
  });
  it('requires a verified Google identity before reaching the database', async () => {
    const context = (user: unknown) =>
      ({
        client: {
          auth: { getUser: async () => ({ data: { user }, error: null }) },
        },
        headers: new Headers(),
      }) as ReturnType<typeof authContext>;
    await expect(requireMember(context(null))).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      requireMember(
        context({
          id: 'id',
          email_confirmed_at: '2026-09-05',
          identities: [{ provider: 'email' }],
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      requireMember(
        context({ id: 'id', identities: [{ provider: 'google' }] }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('bounds streamed request bodies and refuses invalid JSON', async () => {
    await expect(
      readJson(
        new Request('https://workspace.example', {
          method: 'POST',
          body: 'x'.repeat(101),
        }),
        100,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      readJson(
        new Request('https://workspace.example', {
          method: 'POST',
          body: 'not json',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
describe('configurable settlement windows', () => {
  const now = new Date('2026-09-04T12:00:00Z');
  const data = buildSandboxData(now);
  it('uses changed bank and ledger SLAs without changing the evidence', () => {
    expect(reconcileTransaction('TXN-1055', data, now).status).toBe('pending');
    expect(
      reconcileTransaction('TXN-1055', data, now, { bankMinutes: 10 }).status,
    ).toBe('delayed');
    expect(
      reconcileTransaction('TXN-1062', data, now, { ledgerMinutes: 43200 })
        .status,
    ).toBe('pending');
    expect(
      reconcileTransaction('TXN-1055', data, now, { bankMinutes: 10 }).evidence,
    ).toEqual(reconcileTransaction('TXN-1055', data, now).evidence);
  });
  it('uses the Admin gateway window and retains default behavior without it', () => {
    expect(reconcileTransaction('TXN-1048', data, now).status).toBe('delayed');
    expect(
      reconcileTransaction('TXN-1048', data, now, { gatewayMinutes: 43200 })
        .status,
    ).toBe('pending');
    expect(
      reconcileTransaction('TXN-1055', data, now, { bankMinutes: Number.NaN }),
    ).toEqual(reconcileTransaction('TXN-1055', data, now));
  });
});
describe('Stripe sandbox source integrity', () => {
  const event = {
    id: 'evt_123',
    type: 'charge.captured',
    created: 1788580800,
    livemode: false,
    data: {
      object: {
        id: 'ch_123',
        object: 'charge',
        captured: true,
        paid: true,
        amount_captured: 10000,
        currency: 'inr',
        metadata: { transaction_id: 'TXN-5000' },
      },
    },
  };
  it('keeps the capture event time and exact minor amount', () => {
    expect(stripeEventToGateway(event, 120)).toMatchObject({
      transactionId: 'TXN-5000',
      amount: 10000,
      currency: 'INR',
      gatewayReference: 'ch_123',
      capturedAt: new Date(event.created * 1000).toISOString(),
    });
  });
  it('does not import live, uncaptured, or unsupported currency evidence', () => {
    expect(stripeEventToGateway({ ...event, livemode: true }, 120)).toBeNull();
    for (const extra of [
      { captured: false },
      { paid: false },
      { currency: 'jpy' },
      { amount_captured: 0 },
    ])
      expect(
        stripeEventToGateway(
          { ...event, data: { object: { ...event.data.object, ...extra } } },
          120,
        ),
      ).toBeNull();
  });
});
describe('document evidence review', () => {
  const evidence = {
    transactionId: 'TXN-5000',
    settlementId: null,
    bankReference: 'BANK-5000',
    utr: null,
    amountMinor: 10000,
    currency: 'INR',
    creditedAt: null,
    bankStatus: 'credited',
    uncertainty: 'Settlement ID and timezone unavailable.',
  };
  it('returns missing fields for review without inventing a timestamp', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(evidence) }] } },
        ],
      }),
    );
    const result = await extractDocument(
      { mimeType: 'application/pdf', data: btoa('%PDF-1.4 test') },
      fetcher,
    );
    expect(result).toEqual({ evidence, requiresReview: true });
    const request = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(request.generationConfig.responseSchema).toMatchObject({
      type: 'OBJECT',
      properties: {
        amountMinor: { type: 'INTEGER', nullable: true },
        creditedAt: { type: 'STRING', nullable: true },
      },
      required: Object.keys(evidence),
    });
  });
  it('rejects truncated responses even when the partial JSON is valid', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    await expect(
      extractDocument(
        { mimeType: 'application/pdf', data: btoa('%PDF-1.4 test') },
        async () =>
          Response.json({
            candidates: [
              {
                finishReason: 'MAX_TOKENS',
                content: { parts: [{ text: JSON.stringify(evidence) }] },
              },
            ],
          }),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('validates the final answer without treating thought text as evidence', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const result = await extractDocument(
      { mimeType: 'application/pdf', data: btoa('%PDF-1.4 test') },
      async () =>
        Response.json({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    thought: true,
                    text: 'Intermediate reasoning, not extracted fields.',
                  },
                  { text: JSON.stringify(evidence) },
                ],
              },
            },
          ],
        }),
    );
    expect(result).toEqual({ evidence, requiresReview: true });
  });
  it('rejects a mismatched file type before sending it to Gemini', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetcher = vi.fn();
    await expect(
      extractDocument(
        { mimeType: 'image/png', data: btoa('not an image') },
        fetcher,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects malformed model output instead of treating it as evidence', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    await expect(
      extractDocument(
        { mimeType: 'application/pdf', data: btoa('%PDF-1.4 test') },
        async () =>
          Response.json({
            candidates: [
              { content: { parts: [{ text: '{"role":"admin"}' }] } },
            ],
          }),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});
