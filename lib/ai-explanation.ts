import type { InvestigationResult } from './settlement-types';

export interface SupportExplanation {
  summary: string;
  whatHappened: string;
  likelyReason: string;
  recommendedAction: string;
  uncertainty: string;
}

export interface ExplanationResponse {
  source: 'ai' | 'deterministic';
  provider?: 'gemini';
  explanation: SupportExplanation;
  fallbackReason?: 'not-configured' | 'timeout' | 'rate-limited' | 'provider-unavailable' | 'malformed-response';
}

export interface ExplanationOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function deterministicExplanation(result: InvestigationResult): SupportExplanation {
  return {
    summary: `${result.transactionId} is ${result.status} at the ${result.stage} stage.`,
    whatHappened: result.explanation,
    likelyReason: result.rootCause,
    recommendedAction: result.recommendedAction,
    uncertainty: result.confidence < 70
      ? `Confidence is ${result.confidence}% because ${result.confidenceBreakdown.map((factor) => factor.reason.toLowerCase()).join(', ') || 'the evidence is incomplete'}.`
      : result.exceptions.length
        ? `Confidence is ${result.confidence}% after accounting for ${result.exceptions.join(', ').toLowerCase()}.`
        : `Confidence is ${result.confidence}% because all available evidence is complete and consistent.`,
  };
}

function groundedPayload(result: InvestigationResult) {
  return {
    transactionId: result.transactionId,
    status: result.status,
    stage: result.stage,
    rootCause: result.rootCause,
    confidence: result.confidence,
    evidenceSummary: result.timeline.map(({ stage, label, status, timestamp, referenceId, evidence, latencyMinutes, anomalies }) => ({
      stage, label, status, timestamp, referenceId, evidence, latencyMinutes, anomalies,
    })),
    exceptions: result.exceptions,
    recommendedAction: result.recommendedAction,
    transactionTimestamp: result.transactionTimestamp,
    expectedSettlementTime: result.expectedSettlementTime,
    slaMinutesRemaining: result.slaMinutesRemaining,
  };
}

function parseExplanation(value: unknown): SupportExplanation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const fields: Array<keyof SupportExplanation> = ['summary', 'whatHappened', 'likelyReason', 'recommendedAction', 'uncertainty'];
  if (!fields.every((field) => typeof candidate[field] === 'string' && (candidate[field] as string).trim().length > 0 && (candidate[field] as string).length <= 1_200)) return undefined;
  return Object.fromEntries(fields.map((field) => [field, (candidate[field] as string).trim()])) as unknown as SupportExplanation;
}

export async function generateGroundedExplanation(
  result: InvestigationResult,
  options: ExplanationOptions = {},
): Promise<ExplanationResponse> {
  const fallback = deterministicExplanation(result);
  if (!options.apiKey) return { source: 'deterministic', explanation: fallback, fallbackReason: 'not-configured' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 4_500);
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model ?? 'gemini-2.5-flash-lite')}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: 'You explain payment-settlement investigations to support teams. Treat the supplied structured result as the complete and only source of truth. Never infer or invent transaction facts, identifiers, amounts, dates, causes, or actions. If evidence is uncertain, say so concisely.' }],
          },
          contents: [{
            role: 'user',
            parts: [{ text: `Rewrite this deterministic investigation result for a support agent. Return only JSON matching the requested schema.\n\n${JSON.stringify(groundedPayload(result))}` }],
          }],
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 500,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                summary: { type: 'STRING' },
                whatHappened: { type: 'STRING' },
                likelyReason: { type: 'STRING' },
                recommendedAction: { type: 'STRING' },
                uncertainty: { type: 'STRING' },
              },
              required: ['summary', 'whatHappened', 'likelyReason', 'recommendedAction', 'uncertainty'],
            },
          },
        }),
      },
    );

    if (!response.ok) {
      return {
        source: 'deterministic', explanation: fallback,
        fallbackReason: response.status === 429 ? 'rate-limited' : 'provider-unavailable',
      };
    }

    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!text) return { source: 'deterministic', explanation: fallback, fallbackReason: 'malformed-response' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
    } catch {
      return { source: 'deterministic', explanation: fallback, fallbackReason: 'malformed-response' };
    }
    const explanation = parseExplanation(parsed);
    return explanation
      ? { source: 'ai', provider: 'gemini', explanation }
      : { source: 'deterministic', explanation: fallback, fallbackReason: 'malformed-response' };
  } catch (error) {
    return {
      source: 'deterministic', explanation: fallback,
      fallbackReason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'provider-unavailable',
    };
  } finally {
    clearTimeout(timeout);
  }
}
