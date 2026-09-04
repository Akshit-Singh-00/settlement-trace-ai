import { describe, expect, it, vi } from 'vitest';
import { deterministicExplanation, generateGroundedExplanation } from './ai-explanation';
import { reconcileTransaction } from './reconciliation';
import { buildSandboxData } from './sandbox-data';

const reference = new Date('2026-09-04T12:00:00.000Z');
const result = reconcileTransaction('TXN-1048', buildSandboxData(reference), reference);

describe('grounded explanation layer', () => {
  it('uses the deterministic explanation immediately when no key exists', async () => {
    const response = await generateGroundedExplanation(result, { apiKey: undefined });
    expect(response.source).toBe('deterministic');
    expect(response.fallbackReason).toBe('not-configured');
    expect(response.explanation).toEqual(deterministicExplanation(result));
  });

  it('falls back when the provider rate limits the request', async () => {
    const response = await generateGroundedExplanation(result, {
      apiKey: 'test-key',
      fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 429 })) as typeof fetch,
    });
    expect(response).toMatchObject({ source: 'deterministic', fallbackReason: 'rate-limited' });
  });

  it('falls back when an AI response is malformed', async () => {
    const response = await generateGroundedExplanation(result, {
      apiKey: 'test-key',
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: '{"summary":"partial"}' }] } }] })) as typeof fetch,
    });
    expect(response).toMatchObject({ source: 'deterministic', fallbackReason: 'malformed-response' });
  });

  it('accepts a complete grounded provider response', async () => {
    const explanation = {
      summary: 'The settlement is delayed.',
      whatHappened: result.explanation,
      likelyReason: result.rootCause,
      recommendedAction: result.recommendedAction,
      uncertainty: 'Confidence reflects a missing settlement record.',
    };
    const response = await generateGroundedExplanation(result, {
      apiKey: 'test-key',
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(explanation) }] } }] })) as typeof fetch,
    });
    expect(response).toMatchObject({ source: 'ai', provider: 'gemini', explanation });
  });
});
