import { generateGroundedExplanation } from '@/lib/ai-explanation';
import type { InvestigationResult } from '@/lib/settlement-types';

export const runtime = 'edge';

function isInvestigationResult(value: unknown): value is InvestigationResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<InvestigationResult>;
  return typeof candidate.transactionId === 'string'
    && typeof candidate.status === 'string'
    && typeof candidate.stage === 'string'
    && typeof candidate.rootCause === 'string'
    && typeof candidate.confidence === 'number'
    && Array.isArray(candidate.timeline)
    && Array.isArray(candidate.exceptions)
    && typeof candidate.recommendedAction === 'string';
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { result?: unknown };
    if (!isInvestigationResult(body.result)) {
      return Response.json({ error: 'A valid structured investigation result is required.' }, { status: 400 });
    }

    const response = await generateGroundedExplanation(body.result, {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL,
    });
    return Response.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json({ error: 'The explanation request could not be processed.' }, { status: 400 });
  }
}
