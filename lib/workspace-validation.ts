import { z } from 'zod';

export const roleSchema = z.enum(['viewer', 'investigator', 'admin']);
const timezone = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Choose a valid timezone.');
const safeUrl = z.union([
  z.literal(''),
  z
    .url()
    .max(1000)
    .refine(
      (value) => new URL(value).protocol === 'https:',
      'Use an HTTPS URL.',
    ),
]);
export const profileSchema = z
  .object({
    display_name: z.string().trim().min(2).max(80),
    avatar_url: safeUrl,
    theme: z.enum(['light', 'dark', 'system']),
    timezone,
    default_view: z.enum(['overview', 'exceptions']),
  })
  .strict();
export const memberSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    role: roleSchema,
  })
  .strict();
export const memberUpdateSchema = z
  .object({ role: roleSchema, active: z.boolean() })
  .strict();
export const noteSchema = z
  .object({
    body: z.string().trim().min(1).max(3000),
    reference_url: safeUrl.default(''),
  })
  .strict();
export const caseSchema = z
  .object({
    status: z.enum(['todo', 'in_progress', 'resolved']),
    assignee_id: z.uuid().nullable(),
  })
  .strict();
export const settingsSchema = z
  .object({
    bank_sla_minutes: z.number().int().min(1).max(43200),
    ledger_sla_minutes: z.number().int().min(1).max(43200),
    gateway_sla_minutes: z.number().int().min(1).max(43200),
    alert_after_minutes: z.number().int().min(1).max(43200),
    alerts_enabled: z.boolean(),
  })
  .strict();
export const importSchema = z
  .object({
    source: z.enum(['gateway', 'settlement', 'bank', 'ledger']),
    csv: z.string().min(1).max(1_000_000),
  })
  .strict();
export const traceSchema = z
  .object({
    transactionId: z
      .string()
      .trim()
      .min(4)
      .max(100)
      .regex(/^TXN-[A-Za-z0-9-]+$/),
  })
  .strict();
export const bulkCaseSchema = z
  .object({
    transactionIds: z.array(traceSchema.shape.transactionId).min(1).max(100),
    status: z.enum(['todo', 'in_progress', 'resolved']),
  })
  .strict();
