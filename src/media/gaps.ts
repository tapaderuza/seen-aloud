import type { CaptionCue, Scene, TimeRange } from '../core/types';

/**
 * What is said during each scene, from captions. The script writer uses it to
 * avoid describing what the dialogue already tells the listener.
 */
export function dialogueByScene(
  scenes: readonly Scene[],
  captions: readonly CaptionCue[],
  maxChars = 240,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const scene of scenes) {
    const text = captions
      .filter((c) => c.end > scene.start && c.start < scene.end)
      .map((c) => c.text.trim())
      .filter(Boolean)
      .join(' ');
    if (text) out.set(scene.id, text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text);
  }
  return out;
}

/** Merges overlapping or touching ranges and sorts them. */
export function mergeRanges(ranges: readonly TimeRange[], joinWithinSec = 0): TimeRange[] {
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + joinWithinSec) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push(r);
    }
  }
  return out;
}

/** The parts of [0, duration] not covered by `ranges`. */
export function complement(ranges: readonly TimeRange[], duration: number): TimeRange[] {
  const merged = mergeRanges(ranges);
  const out: TimeRange[] = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor) out.push({ start: cursor, end: Math.min(r.start, duration) });
    cursor = Math.max(cursor, r.end);
    if (cursor >= duration) break;
  }
  if (cursor < duration) out.push({ start: cursor, end: duration });
  return out.filter((r) => r.end - r.start > 0);
}

/**
 * Pauses between caption cues. Captions are the most precise record of when
 * someone is talking, so they win over audio analysis when the user has them.
 */
export function gapsFromCaptions(cues: readonly CaptionCue[], duration: number, paddingSec = 0.2): TimeRange[] {
  const speech = cues.map((c) => ({
    start: Math.max(0, c.start - paddingSec),
    end: Math.min(duration, c.end + paddingSec),
  }));
  return complement(speech, duration);
}

/**
 * The longest stretch of `gaps` inside a scene. A description may run a little
 * past the cut (`spillSec`) because listeners tolerate that better than talking
 * over dialogue.
 */
export function bestWindowForScene(
  scene: TimeRange,
  gaps: readonly TimeRange[],
  minSec = 1,
  spillSec = 0.5,
): TimeRange | null {
  let best: TimeRange | null = null;
  for (const g of gaps) {
    const start = Math.max(scene.start, g.start);
    const end = Math.min(scene.end + spillSec, g.end);
    if (end - start < minSec) continue;
    if (!best || end - start > best.end - best.start + 1e-9) best = { start, end };
  }
  return best;
}
