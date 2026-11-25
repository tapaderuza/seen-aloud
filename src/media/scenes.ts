import type { Scene } from '../core/types';

/** A tiny fingerprint of one sampled frame, cheap enough to keep hundreds in memory. */
export interface FrameSignature {
  time: number;
  /** Luma per pixel of a downscaled frame, 0..255. */
  luma: Uint8Array;
  /** 16-bin luma histogram, normalised to sum to 1. */
  histogram: Float32Array;
  /** Mean R, G, B of a 4x4 grid of blocks (48 values), so hue changes with equal brightness still count. */
  chroma: Uint8Array;
}

export interface SceneOptions {
  /** Distance (0..1) between consecutive samples that counts as a cut. */
  threshold: number;
  /** Cuts closer than this to the previous one are ignored (flashes, fast pans). */
  minSceneSec: number;
  /** Longer shots are split so a static talking head still gets refreshed descriptions. */
  maxSceneSec: number;
}

export const DEFAULT_SCENE_OPTIONS: SceneOptions = {
  threshold: 0.3,
  minSceneSec: 1.5,
  maxSceneSec: 12,
};

const BINS = 16;
const GRID = 4;

/**
 * Slide decks, screencasts and recorded lectures barely move between slides,
 * so a slide change can score far below the fixed threshold. A change this
 * many times bigger than the video's own typical motion (its 90th percentile)
 * also counts as a cut. In footage that moves all the time the bar rises with
 * the motion, so only the fixed threshold applies there.
 */
const RELATIVE_FACTOR = 5;
/** The relative rule never accepts a change smaller than this, so a still video's noise is not a cut. */
const RELATIVE_FLOOR = 0.08;

/** Builds a signature from RGBA pixels (as returned by `getImageData`). */
export function signatureFromRGBA(
  time: number,
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): FrameSignature {
  const pixels = width * height;
  if (rgba.length < pixels * 4) {
    throw new RangeError(`Expected ${pixels * 4} bytes of RGBA, got ${rgba.length}`);
  }
  const luma = new Uint8Array(pixels);
  const histogram = new Float32Array(BINS);
  const sums = new Float64Array(GRID * GRID * 3);
  const counts = new Float64Array(GRID * GRID);
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const cell = Math.min(GRID - 1, Math.floor(((i % width) / width) * GRID)) +
      GRID * Math.min(GRID - 1, Math.floor((Math.floor(i / width) / height) * GRID));
    sums[cell * 3] += rgba[o];
    sums[cell * 3 + 1] += rgba[o + 1];
    sums[cell * 3 + 2] += rgba[o + 2];
    counts[cell] += 1;
    // ITU-R BT.601 luma, integer maths.
    const y = (rgba[o] * 299 + rgba[o + 1] * 587 + rgba[o + 2] * 114) / 1000;
    const v = y > 255 ? 255 : y;
    luma[i] = v;
    histogram[Math.min(BINS - 1, Math.floor(v / (256 / BINS)))] += 1;
  }
  for (let b = 0; b < BINS; b++) histogram[b] /= pixels;
  const chroma = new Uint8Array(GRID * GRID * 3);
  for (let c = 0; c < GRID * GRID; c++) {
    for (let k = 0; k < 3; k++) chroma[c * 3 + k] = counts[c] ? sums[c * 3 + k] / counts[c] : 0;
  }
  return { time, luma, histogram, chroma };
}

/**
 * How different two frames look, from 0 (identical) to 1 (nothing in common).
 * Half histogram distance (catches lighting and colour changes), half pixel
 * distance (catches a new composition with similar colours).
 */
export function frameDistance(a: FrameSignature, b: FrameSignature): number {
  if (a.luma.length !== b.luma.length) {
    throw new RangeError('Signatures must come from frames of the same size');
  }
  let hist = 0;
  for (let i = 0; i < BINS; i++) hist += Math.abs(a.histogram[i] - b.histogram[i]);
  hist /= 2; // L1 distance between two distributions is at most 2.

  let pix = 0;
  for (let i = 0; i < a.luma.length; i++) pix += Math.abs(a.luma[i] - b.luma[i]);
  pix /= a.luma.length * 255;

  let col = 0;
  for (let i = 0; i < a.chroma.length; i++) col += Math.abs(a.chroma[i] - b.chroma[i]);
  col /= a.chroma.length * 255;

  // Whichever view sees a bigger change wins; colour is amplified because a grid average dilutes it.
  return Math.max(0.5 * hist + 0.5 * pix, Math.min(1, col * 2.4));
}

/** Turns a time series of frame signatures into scenes covering [0, duration]. */
export function detectScenes(
  signatures: readonly FrameSignature[],
  duration: number,
  options: SceneOptions = DEFAULT_SCENE_OPTIONS,
): Scene[] {
  if (!(duration > 0)) return [];
  const cuts: number[] = [0];

  const distances: number[] = [];
  for (let i = 1; i < signatures.length; i++) distances.push(frameDistance(signatures[i - 1], signatures[i]));
  const relativeBar = Math.max(RELATIVE_FLOOR, RELATIVE_FACTOR * percentile(distances, 0.9));

  for (let i = 1; i < signatures.length; i++) {
    const t = signatures[i].time;
    if (t <= 0 || t >= duration) continue;
    const d = distances[i - 1];
    const isCut = d >= options.threshold || d >= relativeBar;
    if (isCut && t - cuts[cuts.length - 1] >= options.minSceneSec) {
      cuts.push(t);
    }
  }

  // A short tail after the last cut belongs to the previous scene.
  if (cuts.length > 1 && duration - cuts[cuts.length - 1] < options.minSceneSec) {
    cuts.pop();
  }

  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < cuts.length; i++) {
    const start = cuts[i];
    const end = i + 1 < cuts.length ? cuts[i + 1] : duration;
    const pieces = Math.max(1, Math.ceil((end - start) / options.maxSceneSec - 1e-9));
    const step = (end - start) / pieces;
    for (let p = 0; p < pieces; p++) {
      ranges.push([start + p * step, p === pieces - 1 ? end : start + (p + 1) * step]);
    }
  }

  return ranges.map(([start, end], index) => ({
    id: `s${index + 1}`,
    index,
    start: round3(start),
    end: round3(end),
    keyframeTime: round3(keyframeFor(start, end)),
  }));
}

/** Sample one second in (or the middle of short scenes) to avoid dissolves at the cut. */
export function keyframeFor(start: number, end: number): number {
  const len = end - start;
  return start + Math.min(1, len / 2);
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
