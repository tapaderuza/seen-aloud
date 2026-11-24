import { describe, expect, it, vi } from 'vitest';
import { isTransientCloudError, withCloudRetry } from '../src/ai/retry';
import { DEFAULT_SETTINGS, settingsFromRemote } from '../src/config/settings';

const busy = () => Object.assign(new Error('[500 ] This model is currently experiencing high demand.'), {});
const withStatus = (status: number) => Object.assign(new Error('fetch failed'), { customErrorData: { status } });
const appCheck = () => new Error('Error fetching: [401 ] Firebase App Check token is invalid.');
const noSleep = async () => undefined;

describe('isTransientCloudError', () => {
  it('accepts busy, unavailable and rate-limit statuses', () => {
    expect(isTransientCloudError(busy())).toBe(true);
    expect(isTransientCloudError(withStatus(503))).toBe(true);
    expect(isTransientCloudError(withStatus(429))).toBe(true);
  });
  it('rejects client errors and unknown values', () => {
    expect(isTransientCloudError(appCheck())).toBe(false);
    expect(isTransientCloudError(withStatus(400))).toBe(false);
    expect(isTransientCloudError('boom')).toBe(false);
    expect(isTransientCloudError(null)).toBe(false);
  });
});

describe('withCloudRetry', () => {
  it('returns the first answer without waiting', async () => {
    const sleep = vi.fn(noSleep);
    const primary = vi.fn(async () => 'ok');
    expect(await withCloudRetry(primary, null, { delayMs: 10, sleep })).toBe('ok');
    expect(primary).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries the same model once after a busy error', async () => {
    const sleep = vi.fn(noSleep);
    const primary = vi.fn().mockRejectedValueOnce(busy()).mockResolvedValueOnce('second');
    expect(await withCloudRetry(primary, null, { delayMs: 25, sleep })).toBe('second');
    expect(primary).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(25);
  });

  it('falls back to the other model when the retry is busy too', async () => {
    const primary = vi.fn().mockRejectedValue(busy());
    const fallback = vi.fn(async () => 'fallback');
    expect(await withCloudRetry(primary, fallback, { delayMs: 1, sleep: noSleep })).toBe('fallback');
    expect(primary).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('throws the last busy error when there is no fallback', async () => {
    const primary = vi.fn().mockRejectedValue(busy());
    await expect(withCloudRetry(primary, null, { delayMs: 1, sleep: noSleep })).rejects.toThrow('high demand');
    expect(primary).toHaveBeenCalledTimes(2);
  });

  it('never retries an App Check or other client error', async () => {
    const primary = vi.fn().mockRejectedValue(appCheck());
    const fallback = vi.fn(async () => 'fallback');
    await expect(withCloudRetry(primary, fallback, { delayMs: 1, sleep: noSleep })).rejects.toThrow('App Check');
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('cloudFallbackModel setting', () => {
  it('has a default and accepts a valid Remote Config value', () => {
    expect(DEFAULT_SETTINGS.cloudFallbackModel).toBe('gemini-2.5-flash');
    const s = settingsFromRemote((k) => (k === 'cloud_fallback_model' ? 'gemini-2.5-flash-lite' : undefined));
    expect(s.cloudFallbackModel).toBe('gemini-2.5-flash-lite');
  });
  it('lets Remote Config switch it off with an empty value and ignores bad names', () => {
    expect(settingsFromRemote((k) => (k === 'cloud_fallback_model' ? '' : undefined)).cloudFallbackModel).toBe('');
    expect(settingsFromRemote((k) => (k === 'cloud_fallback_model' ? 'bad name!' : undefined)).cloudFallbackModel).toBe(
      DEFAULT_SETTINGS.cloudFallbackModel,
    );
  });
});
