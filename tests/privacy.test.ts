import { describe, expect, it } from 'vitest';
import { pausesFromSoundtrack } from '../src/app/pipeline';
import { withCloudRetry, isTransientCloudError } from '../src/ai/retry';
import { pickVoice } from '../src/player/describer';
import { LocalTrackLibrary, type TrackStore } from '../src/storage/localLibrary';
import type { SavedTrack } from '../src/firebase/library';

/** An in-memory stand-in for IndexedDB with the same contract. */
class MemoryStore implements TrackStore {
  rows = new Map<string, Record<string, unknown>>();
  async put(id: string, value: Record<string, unknown>) {
    this.rows.set(id, structuredClone(value));
  }
  async all() {
    return [...this.rows].map(([id, value]) => ({ id, value }));
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
}

function track(title: string): SavedTrack {
  return {
    id: '',
    title,
    fileName: `${title}.mp4`,
    durationSec: 12.345,
    language: 'en',
    mode: 'private',
    cues: [{ sceneId: 's1', start: 0, end: 4, budgetWords: 10, extended: false, text: 'A door opens.', source: 'on_device' }],
    ledger: { onDevice: 2, inCloud: 0, framesOnDevice: 1, framesInCloud: 0 },
    updatedAt: 0,
  };
}

describe('voices', () => {
  const voices = [
    { lang: 'en-US', localService: false, name: 'Network English' },
    { lang: 'en-GB', localService: true, name: 'Local English' },
    { lang: 'es-ES', localService: false, name: 'Network Spanish' },
  ];

  it('prefers a voice installed on this computer', () => {
    expect(pickVoice(voices, 'en', 'prefer-local')?.name).toBe('Local English');
  });

  it('in Private mode never picks a network voice', () => {
    expect(pickVoice(voices, 'es', 'local-only')).toBeNull();
    expect(pickVoice(voices, 'es', 'prefer-local')?.name).toBe('Network Spanish');
  });

  it('treats an empty voice list as no allowed voice in Private mode', () => {
    expect(pickVoice([], 'en', 'local-only')).toBeNull();
  });
});

describe('local library (Private mode)', () => {
  it('saves, lists newest first and deletes without any network', async () => {
    const store = new MemoryStore();
    let clock = 1000;
    let n = 0;
    const library = new LocalTrackLibrary(store, () => clock++, () => `id${++n}`);
    const first = await library.save(track('Lecture'));
    const second = await library.save(track('Council'));
    const list = await library.list();
    expect(list.map((t) => [t.id, t.title, t.updatedAt])).toEqual([
      [second, 'Council', 1001],
      [first, 'Lecture', 1000],
    ]);
    expect(list[0].cues[0].text).toBe('A door opens.');
    await library.remove(first);
    expect((await library.list()).map((t) => t.title)).toEqual(['Council']);
  });

  it('updates a track in place when it already has an id', async () => {
    const store = new MemoryStore();
    const library = new LocalTrackLibrary(store, () => 5, () => 'fresh');
    const id = await library.save(track('Draft'));
    await library.save({ ...track('Draft v2'), id });
    expect(store.rows.size).toBe(1);
    expect((await library.list())[0].title).toBe('Draft v2');
  });
});

describe('pauses when the soundtrack cannot be read', () => {
  it('leaves no gap at all, so every description pauses the video instead of covering dialogue', () => {
    for (const soundtrack of [{ status: 'too-large', bytes: 5e8 } as const, { status: 'unreadable' } as const]) {
      const result = pausesFromSoundtrack(soundtrack, 30);
      expect(result.gaps).toEqual([]);
      expect(result.from).toBe('unknown');
      expect(result.note).toBeTruthy();
    }
  });

  it('treats a silent soundtrack as one long pause', () => {
    const result = pausesFromSoundtrack({ status: 'decoded', samples: new Float32Array(16000 * 4), sampleRate: 16000 }, 4);
    expect(result).toMatchObject({ from: 'silent', gaps: [{ start: 0, end: 4 }] });
  });

  it('finds the quiet stretch between two loud ones', () => {
    const rate = 16000;
    const samples = new Float32Array(rate * 6);
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate;
      samples[i] = t < 2 || t >= 4 ? 0.3 * Math.sin(2 * Math.PI * 220 * t) : 0;
    }
    const result = pausesFromSoundtrack({ status: 'decoded', samples, sampleRate: rate }, 6);
    expect(result.from).toBe('audio');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].start).toBeCloseTo(2, 1);
    expect(result.gaps[0].end).toBeCloseTo(4, 1);
  });
});

describe('cloud retries', () => {
  it('reports each extra request', async () => {
    const busy = new Error('[503 Service Unavailable] busy');
    const steps: string[] = [];
    let calls = 0;
    const result = await withCloudRetry(
      async () => {
        calls++;
        throw busy;
      },
      async () => 'fallback answer',
      { delayMs: 0, sleep: async () => {}, onRetry: (step) => steps.push(step) },
    );
    expect(result).toBe('fallback answer');
    expect(calls).toBe(2);
    expect(steps).toEqual(['same-model', 'fallback-model']);
  });

  it('recognises a busy answer with or without status text', () => {
    expect(isTransientCloudError(new Error('Error fetching: [503 Service Unavailable] model overloaded'))).toBe(true);
    expect(isTransientCloudError(new Error('Error fetching: [503 ] model overloaded'))).toBe(true);
    expect(isTransientCloudError(new Error('Error fetching: [400 Bad Request] bad schema'))).toBe(false);
  });
});
