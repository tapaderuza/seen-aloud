import { describe, expect, it } from 'vitest';
import { downmix, findSilences, rmsWindows, toDb } from '../src/media/audio';
import { bestWindowForScene, complement, dialogueByScene, gapsFromCaptions, mergeRanges } from '../src/media/gaps';
import { detectScenes, frameDistance, keyframeFor, signatureFromRGBA, type FrameSignature } from '../src/media/scenes';

const W = 8;
const H = 4;

function solid(time: number, r: number, g: number, b: number): FrameSignature {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) px.set([r, g, b, 255], i * 4);
  return signatureFromRGBA(time, px, W, H);
}

/** Samples every 0.5 s, coloured by the function of time. */
function timeline(duration: number, color: (t: number) => [number, number, number]): FrameSignature[] {
  const out: FrameSignature[] = [];
  for (let t = 0; t < duration; t += 0.5) out.push(solid(t, ...color(t)));
  return out;
}

describe('frame signatures', () => {
  it('gives identical frames a distance of zero', () => {
    expect(frameDistance(solid(0, 10, 200, 30), solid(1, 10, 200, 30))).toBe(0);
  });

  it('gives black and white the maximum distance', () => {
    expect(frameDistance(solid(0, 0, 0, 0), solid(0, 255, 255, 255))).toBeCloseTo(1, 5);
  });

  it('builds a histogram that sums to one', () => {
    const sum = Array.from(solid(0, 120, 40, 200).histogram).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('rejects a buffer that is too small for the frame size', () => {
    expect(() => signatureFromRGBA(0, new Uint8ClampedArray(10), W, H)).toThrow(RangeError);
  });

  it('refuses to compare frames of different sizes', () => {
    const small = signatureFromRGBA(0, new Uint8ClampedArray(4 * 4), 2, 2);
    expect(() => frameDistance(small, solid(0, 0, 0, 0))).toThrow(RangeError);
  });
});

describe('detectScenes', () => {
  const RED: [number, number, number] = [255, 0, 0];
  const BLUE: [number, number, number] = [0, 0, 255];
  const GREEN: [number, number, number] = [0, 255, 0];
  const WHITE: [number, number, number] = [255, 255, 255];
  const options = { threshold: 0.3, minSceneSec: 1.5, maxSceneSec: 12 };

  it('cuts where the picture changes', () => {
    const sigs = timeline(10, (t) => (t < 4 ? RED : BLUE));
    const scenes = detectScenes(sigs, 10, options);
    expect(scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 4],
      [4, 10],
    ]);
    expect(scenes.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('folds a short tail into the previous scene', () => {
    const sigs = timeline(10, (t) => (t < 4 ? RED : t < 9 ? BLUE : GREEN));
    expect(detectScenes(sigs, 10, options).map((s) => s.end)).toEqual([4, 10]);
  });

  it('ignores a flash right after a cut', () => {
    const sigs = timeline(12, (t) => (t < 4 ? RED : t === 4.5 ? WHITE : BLUE));
    expect(detectScenes(sigs, 12, options).map((s) => s.start)).toEqual([0, 4]);
  });

  it('splits a long static shot so it gets fresh descriptions', () => {
    const scenes = detectScenes(
      timeline(30, () => RED),
      30,
      options,
    );
    expect(scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
    ]);
  });

  it('returns nothing for a video without duration', () => {
    expect(detectScenes([], 0, options)).toEqual([]);
  });

  it('takes the key frame one second in, or mid-scene when the scene is short', () => {
    expect(keyframeFor(4, 10)).toBe(5);
    expect(keyframeFor(4, 5)).toBe(4.5);
    const [first] = detectScenes(timeline(10, () => RED), 10, options);
    expect(first.keyframeTime).toBe(1);
  });
});

describe('audio pauses', () => {
  const rate = 1000;

  function signal(parts: Array<[seconds: number, amplitude: number]>): Float32Array {
    const total = parts.reduce((n, [s]) => n + Math.round(s * rate), 0);
    const out = new Float32Array(total);
    let i = 0;
    for (const [seconds, amplitude] of parts) {
      const n = Math.round(seconds * rate);
      for (let k = 0; k < n; k++, i++) out[i] = amplitude * Math.sin(i * 0.7);
    }
    return out;
  }

  it('finds the pause between two stretches of speech and ignores short breaths', () => {
    const audio = signal([
      [2, 0.5],
      [1.5, 0.0005],
      [1.5, 0.5],
      [0.4, 0.0005],
      [0.6, 0.5],
    ]);
    const silences = findSilences(rmsWindows(audio, rate, 0.05), 0.05);
    expect(silences).toHaveLength(1);
    expect(silences[0].start).toBeCloseTo(2, 1);
    expect(silences[0].end).toBeCloseTo(3.5, 1);
  });

  it('treats a silent soundtrack as one long pause', () => {
    const silences = findSilences(rmsWindows(new Float32Array(3000), rate, 0.05), 0.05);
    expect(silences).toEqual([{ start: 0, end: 3 }]);
  });

  it('never calls loud music silence, whatever the noise floor', () => {
    const music = signal([[4, 0.4]]);
    expect(findSilences(rmsWindows(music, rate, 0.05), 0.05)).toEqual([]);
  });

  it('converts levels to decibels', () => {
    expect(toDb(1)).toBe(0);
    expect(toDb(0.1)).toBeCloseTo(-20, 5);
    expect(toDb(0)).toBe(-180);
  });

  it('averages channels when mixing down', () => {
    const mono = downmix([Float32Array.from([1, 0]), Float32Array.from([0, 1])]);
    expect(Array.from(mono)).toEqual([0.5, 0.5]);
    expect(downmix([]).length).toBe(0);
  });
});

describe('gaps', () => {
  it('merges overlapping ranges in order', () => {
    expect(
      mergeRanges([
        { start: 5, end: 6 },
        { start: 0, end: 2 },
        { start: 1, end: 3 },
      ]),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 6 },
    ]);
  });

  it('finds what is left uncovered', () => {
    expect(complement([{ start: 1, end: 2 }], 4)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 4 },
    ]);
    expect(complement([], 3)).toEqual([{ start: 0, end: 3 }]);
  });

  it('turns captions into pauses, with a little padding around speech', () => {
    const gaps = gapsFromCaptions(
      [
        { start: 1, end: 3, text: 'Hello' },
        { start: 6, end: 8, text: 'Bye' },
      ],
      10,
    );
    expect(gaps).toEqual([
      { start: 0, end: 0.8 },
      { start: 3.2, end: 5.8 },
      { start: 8.2, end: 10 },
    ]);
  });

  it('picks the longest pause inside a scene and lets it spill a little past the cut', () => {
    const gaps = [
      { start: 0, end: 1.5 },
      { start: 3, end: 9 },
    ];
    expect(bestWindowForScene({ start: 0, end: 6 }, gaps)).toEqual({ start: 3, end: 6.5 });
  });

  it('returns null when no pause is long enough', () => {
    expect(bestWindowForScene({ start: 0, end: 5 }, [{ start: 1, end: 1.5 }])).toBeNull();
  });

  it('collects the dialogue spoken during each scene', () => {
    const map = dialogueByScene(
      [
        { id: 's1', index: 0, start: 0, end: 5, keyframeTime: 1 },
        { id: 's2', index: 1, start: 5, end: 10, keyframeTime: 6 },
      ],
      [
        { start: 1, end: 2, text: 'Welcome to the kitchen.' },
        { start: 7, end: 8, text: 'Now we add salt.' },
      ],
    );
    expect(map.get('s1')).toBe('Welcome to the kitchen.');
    expect(map.get('s2')).toBe('Now we add salt.');
  });
});
