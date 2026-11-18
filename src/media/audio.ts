import type { TimeRange } from '../core/types';

export interface SilenceOptions {
  /** Pauses shorter than this cannot hold a description. */
  minSilenceSec: number;
  /** A window counts as quiet when it is this many dB above the quietest 10 %. */
  marginDb: number;
  /** Never treat anything louder than this as silence, whatever the noise floor. */
  ceilingDb: number;
}

export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = {
  minSilenceSec: 0.8,
  marginDb: 10,
  ceilingDb: -32,
};

/** Root-mean-square level of consecutive windows of a mono signal. */
export function rmsWindows(samples: Float32Array, sampleRate: number, windowSec = 0.05): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * windowSec));
  const count = Math.ceil(samples.length / size);
  const out = new Float32Array(count);
  for (let w = 0; w < count; w++) {
    const from = w * size;
    const to = Math.min(samples.length, from + size);
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    out[w] = Math.sqrt(sum / Math.max(1, to - from));
  }
  return out;
}

export function toDb(rms: number): number {
  return rms <= 1e-9 ? -180 : 20 * Math.log10(rms);
}

/**
 * Finds stretches quiet enough to speak a description over. Works on the
 * relative noise floor, so a video with steady room tone still has pauses.
 */
export function findSilences(
  rms: Float32Array,
  windowSec: number,
  options: SilenceOptions = DEFAULT_SILENCE_OPTIONS,
): TimeRange[] {
  if (rms.length === 0) return [];
  const db = Array.from(rms, toDb);
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const threshold = Math.min(options.ceilingDb, floor + options.marginDb);

  const ranges: TimeRange[] = [];
  let runStart = -1;
  for (let i = 0; i <= db.length; i++) {
    const quiet = i < db.length && db[i] <= threshold;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) {
      const start = runStart * windowSec;
      const end = i * windowSec;
      if (end - start >= options.minSilenceSec) ranges.push({ start: round2(start), end: round2(end) });
      runStart = -1;
    }
  }
  return ranges;
}

/** Mixes any number of channels down to one. */
export function downmix(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) out[i] += channel[i] / channels.length;
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
