/**
 * Cloud requests sometimes fail for reasons that go away by themselves: a model
 * under heavy demand (500/503) or a short rate limit (429). Those are retried
 * once with a pause, then handed to a fallback model. Anything else (a bad
 * schema, App Check, a blocked prompt) fails at once so real bugs stay visible.
 */

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

export function isTransientCloudError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const data = (error as { customErrorData?: { status?: unknown } }).customErrorData;
  if (data && typeof data.status === 'number') return TRANSIENT_STATUS.has(data.status);
  const message = String((error as { message?: unknown }).message ?? '');
  const match = /\[(\d{3})\s*\]/u.exec(message);
  return match ? TRANSIENT_STATUS.has(Number(match[1])) : false;
}

export interface RetryOptions {
  /** Pause before the retry on the same model, in milliseconds. */
  delayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `primary`; on a transient error waits and runs it once more, and if that
 * also fails transiently runs `fallback` (when there is one).
 */
export async function withCloudRetry<T>(
  primary: () => Promise<T>,
  fallback: (() => Promise<T>) | null,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? realSleep;
  try {
    return await primary();
  } catch (first) {
    if (!isTransientCloudError(first)) throw first;
    await sleep(options.delayMs);
    try {
      return await primary();
    } catch (second) {
      if (!isTransientCloudError(second) || !fallback) throw second;
      return fallback();
    }
  }
}
