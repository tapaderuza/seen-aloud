import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cue } from '../src/core/types';
import { DescriptionPlayer } from '../src/player/describer';

/** Fires media events after the call that caused them, like a browser does. */
class FakeVideo extends EventTarget {
  private time = 0;
  paused = true;
  volume = 1;

  get currentTime(): number {
    return this.time;
  }

  set currentTime(value: number) {
    this.time = value;
    this.later('seeking');
  }

  /** Normal playback moving forward (not a seek). */
  advance(seconds: number): void {
    this.time += seconds;
  }

  play(): Promise<void> {
    if (this.paused) {
      this.paused = false;
      this.later('play');
    }
    return Promise.resolve();
  }

  pause(): void {
    if (!this.paused) {
      this.paused = true;
      this.later('pause');
    }
  }

  private later(type: string): void {
    queueMicrotask(() => this.dispatchEvent(new Event(type)));
  }
}

type SpeechListener = ((event: { error?: string }) => void) | null;

class FakeUtterance {
  lang = '';
  rate = 1;
  voice: unknown = null;
  onend: SpeechListener = null;
  onerror: SpeechListener = null;
  constructor(readonly text: string) {}
}

/** Like Chrome: a cancelled line reports 'interrupted' only after the next line is queued. */
class FakeSynth {
  queue: FakeUtterance[] = [];
  spoken: string[] = [];

  speak(utterance: FakeUtterance): void {
    this.queue.push(utterance);
    this.spoken.push(utterance.text);
  }

  cancel(): void {
    for (const utterance of this.queue.splice(0)) {
      queueMicrotask(() => utterance.onerror?.({ error: 'interrupted' }));
    }
  }

  voices: Array<{ lang: string; localService: boolean; name: string }> = [];

  getVoices(): unknown[] {
    return this.voices;
  }

  /** The line being spoken ends normally. */
  finish(): void {
    this.queue.shift()?.onend?.({});
  }
}

let synth: FakeSynth;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

/** Runs one animation frame. */
function tick(): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}

/** Lets queued media and speech events arrive. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function cue(start: number, end: number, text: string, extended = false): Cue {
  return { sceneId: `s${start}`, start, end, budgetWords: 18, extended, text, source: 'on_device' };
}

function setup(cues: Cue[]) {
  const video = new FakeVideo();
  const overlay = document.createElement('p');
  const player = new DescriptionPlayer(video as unknown as HTMLVideoElement, overlay, () => cues, {
    voice: true,
    extendedPauses: true,
    rate: 1,
    lang: 'en',
    wordsPerSecond: 2.5,
  });
  return { video, player };
}

beforeEach(() => {
  synth = new FakeSynth();
  frames = new Map();
  nextFrame = 1;
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('description player', () => {
  it('speaks the line at 0:00 when playback starts at the beginning', async () => {
    const { video } = setup([cue(0, 4, 'A woman opens a door.')]);
    void video.play();
    await settle();
    video.advance(0.02);
    tick();
    expect(synth.spoken).toEqual(['A woman opens a door.']);
  });

  it('speaks the line a "Play from" button jumps to', async () => {
    const lines = [cue(0, 4, 'First line.'), cue(12.34, 16, 'A man waves from a boat.')];
    const { video, player } = setup(lines);
    player.preview(lines[1]);
    await settle(); // 'seeking' and 'play' arrive after preview() returns
    video.advance(0.02);
    tick();
    expect(synth.spoken).toEqual(['A man waves from a boat.']);
  });

  it('resumes after its own pause without repeating the line', async () => {
    const { video } = setup([cue(1, 2, 'A long description of a busy kitchen with many people cooking.', true)]);
    void video.play();
    await settle();
    video.advance(1.02);
    tick();
    await settle();
    expect(video.paused).toBe(true);

    synth.finish();
    await settle();
    expect(video.paused).toBe(false);
    video.advance(0.02);
    tick();
    expect(synth.spoken).toHaveLength(1);
  });

  it('ignores the late "interrupted" of the previous line: the pause holds and the volume comes back', async () => {
    const first = cue(0.5, 4.5, 'A dog runs.');
    const second = cue(1, 3, 'The dog jumps into a lake and swims to the far shore.', true);
    const { video } = setup([first, second]);
    video.volume = 0.8;
    void video.play();
    await settle();

    video.advance(0.6);
    tick(); // the first line starts and ducks the soundtrack
    expect(video.volume).toBeCloseTo(0.35);
    video.advance(0.5);
    tick(); // the second line starts while the first is still talking, and pauses the video
    await settle(); // the first line's 'interrupted' arrives now
    expect(synth.spoken).toEqual([first.text, second.text]);
    expect(video.paused).toBe(true);

    synth.finish();
    await settle();
    expect(video.paused).toBe(false);
    expect(video.volume).toBe(0.8);
  });

  it('in Private mode shows the line as text instead of using a network voice', async () => {
    synth.voices = [{ lang: 'en-US', localService: false, name: 'Network English' }];
    const video = new FakeVideo();
    const overlay = document.createElement('p');
    const warned: string[] = [];
    new DescriptionPlayer(video as unknown as HTMLVideoElement, overlay, () => [cue(0, 4, 'A woman opens a door.')], {
      voice: true,
      extendedPauses: true,
      rate: 1,
      lang: 'en',
      wordsPerSecond: 2.5,
      voicePolicy: 'local-only',
      onNoAllowedVoice: (lang) => warned.push(lang),
    });
    void video.play();
    await settle();
    video.advance(0.02);
    tick();
    expect(synth.spoken).toEqual([]);
    expect(overlay.textContent).toBe('A woman opens a door.');
    expect(overlay.getAttribute('aria-live')).toBe('polite');
    expect(warned).toEqual(['en']);
  });

  it('never leaves the video paused when Chrome loses the end of a line', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { video } = setup([cue(1, 2, 'A long description that does not fit its short pause at all.', true)]);
    video.volume = 0.6;
    void video.play();
    await settle();
    video.advance(1.02);
    tick();
    await settle();
    expect(video.paused).toBe(true);

    vi.advanceTimersByTime(20_000); // no onend ever arrives
    await settle();
    expect(video.paused).toBe(false);
    expect(video.volume).toBe(0.6);
  });
});
