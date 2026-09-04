export async function workspaceApi<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const options: RequestInit = {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
  };
  if (method !== 'GET' && body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`/api/workspace/${path}`, options);
  const data = await response.json();
  if (!response.ok) {
    const failure = data as { error?: string; issues?: string[] };
    throw new Error(
      [failure.error || 'The request failed.', ...(failure.issues || [])].join(
        ' ',
      ),
    );
  }
  return data as T;
}
export function workspaceDate(
  value?: string | null,
  timeZone = 'Asia/Kolkata',
) {
  return value
    ? new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      }).format(new Date(value))
    : 'Not available';
}
export function workspaceMoney(value?: number, currency?: string) {
  if (value === undefined) return 'Not available';
  try {
    if (!currency) return `${value} minor units`;
    const formatter = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
    });
    return formatter.format(
      value / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2),
    );
  } catch {
    return `${value} minor units (${currency})`;
  }
}
export const caseLabels = {
  todo: 'To do',
  in_progress: 'In progress',
  resolved: 'Resolved',
};
