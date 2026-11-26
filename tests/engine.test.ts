import { describe, expect, it, vi } from 'vitest';
import {
  CloudConsentDeclinedError,
  DeviceTimeoutError,
  DescriptionEngine,
  inferenceModeFor,
  PrivacyGuardError,
  type AppMode,
  type DeviceAvailability,
  type GenerateHooks,
  type GenerateResult,
  type InferenceModeValue,
  type ModelProvider,
  type PromptPart,
  type Task,
} from '../src/ai/engine';
import type { CuePlan, Scene, SceneNote } from '../src/core/types';

type Handler = (
  mode: InferenceModeValue,
  parts: PromptPart[],
  hooks?: GenerateHooks,
) => GenerateResult | Promise<GenerateResult>;

/**
 * Behaves like Firebase AI Logic's routing: ONLY_* modes stay on their side,
 * PREFER_ON_DEVICE uses the device when it is available.
 */
class FakeProvider implements ModelProvider {
  availability: DeviceAvailability = 'available';
  calls: Array<{ task: Task; mode: InferenceModeValue; parts: PromptPart[] }> = [];
  handlers: Partial<Record<Task, Handler>> = {};

  route(mode: InferenceModeValue): 'on_device' | 'in_cloud' {
    if (mode === 'only_on_device') return 'on_device';
    if (mode === 'prefer_on_device') return this.availability === 'available' ? 'on_device' : 'in_cloud';
    return 'in_cloud';
  }

  model(task: Task, mode: InferenceModeValue) {
    return {
      generate: async (parts: PromptPart[], hooks?: GenerateHooks) => {
        this.calls.push({ task, mode, parts });
        const handler = this.handlers[task];
        if (handler) return handler(mode, parts, hooks);
        return { text: defaultAnswer(task), source: this.route(mode) };
      },
    };
  }

  async deviceAvailability() {
    return this.availability;
  }

  async prepareDevice(_language: string, onProgress: (f: number) => void) {
    onProgress(1);
    this.availability = 'available';
  }
}

function defaultAnswer(task: Task): string {
  if (task === 'frameNote') return '{"visual":"A woman in a red apron chops onions.","onScreenText":""}';
  if (task === 'fit') return '{"text":"A woman chops onions."}';
  return '{"cues":[{"id":"s1","text":"A woman in a red apron chops onions."},{"id":"s2","text":"She smiles."}]}';
}

const SCENES: Scene[] = [
  { id: 's1', index: 0, start: 0, end: 5, keyframeTime: 1 },
  { id: 's2', index: 1, start: 5, end: 10, keyframeTime: 6 },
];
const IMAGE = { mimeType: 'image/jpeg' as const, data: 'AAAA' };

function engine(provider: FakeProvider, mode: AppMode, confirm?: () => Promise<boolean>) {
  return new DescriptionEngine(provider, {
    mode,
    language: 'en',
    frameMaxWords: 30,
    confirmCloudFrames: confirm,
    now: () => 0,
  });
}

function notes(source: SceneNote['source'] = 'on_device'): Map<string, SceneNote> {
  return new Map([
    ['s1', { sceneId: 's1', visual: 'A woman in a red apron chops onions.', onScreenText: '', source }],
    ['s2', { sceneId: 's2', visual: 'The woman smiles.', onScreenText: 'Chef Ana', source }],
  ]);
}

const PLANS: CuePlan[] = [
  { sceneId: 's1', start: 0.5, end: 4.5, budgetWords: 10, extended: false },
  { sceneId: 's2', start: 5, end: 7, budgetWords: 5, extended: false },
];

const hasImage = (parts: PromptPart[]) => parts.some((p) => p.type === 'inlineData');

describe('hybrid policy', () => {
  it('maps each task to a Firebase AI Logic inference mode', () => {
    expect(inferenceModeFor('frameNote', 'hybrid')).toBe('prefer_on_device');
    expect(inferenceModeFor('fit', 'hybrid')).toBe('prefer_on_device');
    expect(inferenceModeFor('script', 'hybrid')).toBe('prefer_in_cloud');
    expect(inferenceModeFor('script', 'private')).toBe('only_on_device');
    expect(inferenceModeFor('frameNote', 'cloud')).toBe('only_in_cloud');
  });
});

describe('describing frames', () => {
  it('keeps frames on the device when Gemini Nano is ready', async () => {
    const provider = new FakeProvider();
    const confirm = vi.fn(async () => true);
    const e = engine(provider, 'hybrid', confirm);
    const note = await e.describeFrame(SCENES[0], 2, IMAGE);
    expect(note).toMatchObject({ sceneId: 's1', source: 'on_device' });
    expect(e.ledger).toMatchObject({ framesOnDevice: 1, framesInCloud: 0, onDevice: 1 });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('never calls a model in private mode when Gemini Nano is missing', async () => {
    const provider = new FakeProvider();
    provider.availability = 'unsupported';
    const e = engine(provider, 'private');
    await expect(e.describeFrame(SCENES[0], 2, IMAGE)).rejects.toBeInstanceOf(PrivacyGuardError);
    expect(provider.calls).toHaveLength(0);
  });

  it('asks once before sending frames to the cloud, and respects a no', async () => {
    const provider = new FakeProvider();
    provider.availability = 'downloadable';
    const confirm = vi.fn(async () => false);
    const e = engine(provider, 'hybrid', confirm);
    await expect(e.describeFrame(SCENES[0], 2, IMAGE)).rejects.toBeInstanceOf(CloudConsentDeclinedError);
    await expect(e.describeFrame(SCENES[1], 2, IMAGE)).rejects.toBeInstanceOf(CloudConsentDeclinedError);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(provider.calls).toHaveLength(0);
  });

  it('counts frames sent to the cloud after a yes', async () => {
    const provider = new FakeProvider();
    provider.availability = 'unsupported';
    const e = engine(provider, 'hybrid', async () => true);
    await e.describeFrame(SCENES[0], 2, IMAGE);
    await e.describeFrame(SCENES[1], 2, IMAGE);
    expect(e.ledger).toMatchObject({ framesOnDevice: 0, framesInCloud: 2 });
  });

  it('retries in the cloud when Gemini Nano fails mid-request', async () => {
    const provider = new FakeProvider();
    provider.handlers.frameNote = (mode) => {
      if (mode === 'only_on_device') throw Object.assign(new Error('GPU lost'), { name: 'UnknownError' });
      return { text: '{"visual":"A beach.","onScreenText":""}', source: 'in_cloud' };
    };
    const confirm = vi.fn(async () => true);
    const e = engine(provider, 'hybrid', confirm);
    const note = await e.describeFrame(SCENES[0], 2, IMAGE);
    expect(note).toMatchObject({ visual: 'A beach.', source: 'in_cloud' });
    expect(provider.calls.map((c) => c.mode)).toEqual(['only_on_device', 'only_in_cloud']);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(e.ledger.fallbacks).toBe(1);
    expect(e.ledger.events.at(-1)?.note).toContain('retried in the cloud');
  });

  it('pins frames to the device until the person agrees, so a stale "available" cannot reach the cloud', async () => {
    const provider = new FakeProvider();
    // Nano was ready when the video started and is gone now. Inside the SDK,
    // PREFER_ON_DEVICE would quietly use the cloud; ONLY_ON_DEVICE fails.
    provider.handlers.frameNote = (mode) => {
      if (mode === 'only_on_device') throw new Error('Local LanguageModel API not available in this environment.');
      return { text: '{"visual":"A beach.","onScreenText":""}', source: 'in_cloud' };
    };
    const confirm = vi.fn(async () => false);
    const e = engine(provider, 'hybrid', confirm);
    await e.startVideo();
    await expect(e.describeFrame(SCENES[0], 2, IMAGE)).rejects.toBeInstanceOf(CloudConsentDeclinedError);
    expect(provider.calls.map((c) => c.mode)).toEqual(['only_on_device']);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(e.ledger).toMatchObject({ framesInCloud: 0, framesMaybeInCloud: 0 });
  });

  it('stops pinning frames to the device once the person has agreed to the cloud', async () => {
    const provider = new FakeProvider();
    let nanoFails = true;
    provider.handlers.frameNote = (mode) => {
      if (mode === 'only_on_device' && nanoFails) {
        nanoFails = false;
        throw new Error('GPU lost');
      }
      return { text: '{"visual":"A beach.","onScreenText":""}', source: provider.route(mode) };
    };
    const e = engine(provider, 'hybrid', async () => true);
    await e.describeFrame(SCENES[0], 2, IMAGE);
    await e.describeFrame(SCENES[1], 2, IMAGE);
    expect(provider.calls.map((c) => c.mode)).toEqual(['only_on_device', 'only_in_cloud', 'prefer_on_device']);
  });

  it('counts a frame whose cloud request failed as one that may have left the computer', async () => {
    const provider = new FakeProvider();
    provider.availability = 'unsupported';
    provider.handlers.frameNote = () => {
      throw Object.assign(new Error('[503 ] model busy'), { customErrorData: { status: 503 } });
    };
    const e = engine(provider, 'hybrid', async () => true);
    await expect(e.describeFrame(SCENES[0], 2, IMAGE)).rejects.toThrow('model busy');
    expect(e.ledger).toMatchObject({ framesInCloud: 0, framesMaybeInCloud: 1 });
    expect(e.ledger.events.at(-1)?.note).toContain('may have reached the cloud');
  });

  it('counts the frame once when the cloud retry after a device failure fails too', async () => {
    const provider = new FakeProvider();
    provider.handlers.frameNote = (mode) => {
      throw new Error(mode === 'only_in_cloud' ? 'quota' : 'GPU lost');
    };
    const e = engine(provider, 'hybrid', async () => true);
    await expect(e.describeFrame(SCENES[0], 2, IMAGE)).rejects.toThrow('quota');
    expect(e.ledger).toMatchObject({ framesInCloud: 0, framesMaybeInCloud: 1 });
  });

  it('lets a device failure surface in private mode instead of using the cloud', async () => {
    const provider = new FakeProvider();
    provider.handlers.frameNote = () => {
      throw new Error('GPU lost');
    };
    const e = engine(provider, 'private');
    await expect(e.describeFrame(SCENES[0], 2, IMAGE)).rejects.toThrow('GPU lost');
    expect(provider.calls.map((c) => c.mode)).toEqual(['only_on_device']);
    expect(e.ledger.framesMaybeInCloud).toBe(0);
  });

  it('sends frames straight to the cloud in cloud mode without asking', async () => {
    const provider = new FakeProvider();
    const confirm = vi.fn(async () => true);
    const e = engine(provider, 'cloud', confirm);
    await e.describeFrame(SCENES[0], 2, IMAGE);
    expect(provider.calls[0].mode).toBe('only_in_cloud');
    expect(confirm).not.toHaveBeenCalled();
    expect(e.ledger.framesInCloud).toBe(1);
  });

  it('keeps frames on the device when there is no way to ask for consent', async () => {
    const provider = new FakeProvider();
    provider.availability = 'unsupported';
    const e = engine(provider, 'hybrid'); // no confirmCloudFrames callback
    await expect(e.describeFrame(SCENES[0], 2, IMAGE)).rejects.toBeInstanceOf(CloudConsentDeclinedError);
    expect(provider.calls).toHaveLength(0);
  });

  it('in private mode only ever asks for ONLY_ON_DEVICE, for every task', async () => {
    const provider = new FakeProvider();
    const e = engine(provider, 'private');
    await e.startVideo();
    await e.describeFrame(SCENES[0], 2, IMAGE);
    await e.writeTrack(PLANS, notes());
    await e.fit('one two three four five six seven eight', 3);
    expect(provider.calls.length).toBeGreaterThan(0);
    expect(provider.calls.every((c) => c.mode === 'only_on_device')).toBe(true);
    expect(provider.calls.some((c) => c.task === 'script')).toBe(false);
    expect(e.ledger).toMatchObject({ inCloud: 0, framesInCloud: 0, framesMaybeInCloud: 0 });
  });

  it('counts cloud retries, since one inference can be several network requests', async () => {
    const provider = new FakeProvider();
    provider.availability = 'unsupported';
    provider.handlers.frameNote = (_mode, _parts, hooks) => {
      hooks?.onRetry?.('same-model', Object.assign(new Error('[503 ] busy'), { customErrorData: { status: 503 } }));
      hooks?.onRetry?.('fallback-model', Object.assign(new Error('[503 ] busy'), { customErrorData: { status: 503 } }));
      return { text: '{"visual":"A beach.","onScreenText":""}', source: 'in_cloud' };
    };
    const e = engine(provider, 'hybrid', async () => true);
    await e.describeFrame(SCENES[0], 2, IMAGE);
    expect(e.ledger).toMatchObject({ retries: 2, framesInCloud: 1, failures: 0 });
    expect(e.ledger.events.filter((ev) => ev.note?.includes('sent again'))).toHaveLength(2);
  });

  it('counts an inference that fails for good', async () => {
    const provider = new FakeProvider();
    provider.handlers.fit = () => {
      throw new Error('quota');
    };
    const e = engine(provider, 'hybrid');
    await e.startVideo();
    const result = await e.fit('one two three four five six', 3);
    expect(result.text).toBe('one two three.'); // trimmed locally after the failure
    expect(e.ledger.failures).toBe(1);
  });

  it('starts a fresh ledger for each video', async () => {
    const provider = new FakeProvider();
    const onLedgerChange = vi.fn();
    const e = new DescriptionEngine(provider, { mode: 'hybrid', language: 'en', frameMaxWords: 30, onLedgerChange, now: () => 0 });
    await e.startVideo();
    await e.describeFrame(SCENES[0], 2, IMAGE);
    expect(e.ledger).toMatchObject({ onDevice: 1, framesOnDevice: 1 });
    await e.startVideo();
    expect(e.ledger).toMatchObject({ onDevice: 0, inCloud: 0, framesOnDevice: 0, framesInCloud: 0, framesMaybeInCloud: 0 });
    expect(e.ledger.events).toHaveLength(0);
    expect(onLedgerChange).toHaveBeenLastCalledWith(e.ledger);
  });

  it('asks again for consent when a new video starts', async () => {
    const provider = new FakeProvider();
    provider.availability = 'unavailable';
    const confirm = vi.fn(async () => true);
    const e = engine(provider, 'hybrid', confirm);
    await e.describeFrame(SCENES[0], 2, IMAGE);
    await e.startVideo();
    await e.describeFrame(SCENES[0], 2, IMAGE);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('gets the model ready and re-reads availability', async () => {
    const provider = new FakeProvider();
    provider.availability = 'downloadable';
    const e = engine(provider, 'hybrid');
    const progress = vi.fn();
    await expect(e.prepareDevice(progress)).resolves.toBe('available');
    expect(progress).toHaveBeenCalledWith(1);
  });
});

describe('writing the track', () => {
  it('sends one text-only script request to the cloud in hybrid mode', async () => {
    const provider = new FakeProvider();
    const e = engine(provider, 'hybrid');
    await e.startVideo();
    const cues = await e.writeTrack(PLANS, notes());
    const scriptCalls = provider.calls.filter((c) => c.task === 'script');
    expect(scriptCalls).toHaveLength(1);
    expect(scriptCalls[0].mode).toBe('prefer_in_cloud');
    expect(hasImage(scriptCalls[0].parts)).toBe(false);
    expect(cues.map((c) => [c.sceneId, c.text, c.source])).toEqual([
      ['s1', 'A woman in a red apron chops onions.', 'in_cloud'],
      ['s2', 'She smiles.', 'in_cloud'],
    ]);
  });

  it('shortens a line that is over its budget, on the device', async () => {
    const provider = new FakeProvider();
    provider.handlers.script = () => ({
      text: '{"cues":[{"id":"s1","text":"Short."},{"id":"s2","text":"The woman smiles warmly at the camera now."}]}',
      source: 'in_cloud',
    });
    provider.handlers.fit = () => ({ text: '{"text":"The woman smiles."}', source: 'on_device' });
    const e = engine(provider, 'hybrid');
    await e.startVideo();
    const cues = await e.writeTrack(PLANS, notes());
    expect(cues[1]).toMatchObject({ text: 'The woman smiles.', source: 'on_device' });
    const fitCall = provider.calls.find((c) => c.task === 'fit')!;
    expect(fitCall.mode).toBe('prefer_on_device');
  });

  it('finishes scene by scene when the cloud script fails', async () => {
    const provider = new FakeProvider();
    provider.handlers.script = () => {
      throw Object.assign(new Error('offline'), { code: 'fetch-error' });
    };
    const e = engine(provider, 'hybrid');
    await e.startVideo();
    const cues = await e.writeTrack(PLANS, notes());
    expect(cues[0]).toMatchObject({ text: 'A woman in a red apron chops onions.', source: 'on_device' });
    // "The woman smiles. On screen: Chef Ana" is 7 words, over the 5-word budget.
    expect(cues[1].text.split(' ').length).toBeLessThanOrEqual(5);
    expect(e.ledger.events.some((ev) => ev.note?.includes('fetch-error'))).toBe(true);
  });

  it('keeps a scene without a description out of the script and leaves its line empty', async () => {
    const provider = new FakeProvider();
    const e = engine(provider, 'hybrid');
    await e.startVideo();
    const withGap = notes();
    withGap.set('s2', { sceneId: 's2', visual: '', onScreenText: '', source: 'manual' });
    const cues = await e.writeTrack(PLANS, withGap);
    const script = provider.calls.find((c) => c.task === 'script')!;
    const prompt = script.parts[0].type === 'text' ? script.parts[0].text : '';
    expect(prompt).toContain('"id":"s1"');
    expect(prompt).not.toContain('"id":"s2"');
    expect(cues.map((c) => [c.sceneId, c.text])).toEqual([
      ['s1', 'A woman in a red apron chops onions.'],
      ['s2', ''],
    ]);
  });

  it('never makes a script request in private mode', async () => {
    const provider = new FakeProvider();
    const e = engine(provider, 'private');
    await e.startVideo();
    await e.writeTrack(PLANS, notes());
    expect(provider.calls.some((c) => c.task === 'script')).toBe(false);
    expect(provider.calls.every((c) => c.mode === 'only_on_device')).toBe(true);
  });

  it('trims by itself when the rewrite is still too long', async () => {
    const provider = new FakeProvider();
    provider.handlers.fit = () => ({ text: '{"text":"one two three four five six seven"}', source: 'on_device' });
    const e = engine(provider, 'hybrid');
    await e.startVideo();
    const result = await e.fit('a b c d e f g h', 4);
    expect(result.text).toBe('One two three four.');
  });

  it('reports ledger changes as they happen', async () => {
    const provider = new FakeProvider();
    const onLedgerChange = vi.fn();
    const e = new DescriptionEngine(provider, { mode: 'hybrid', language: 'en', frameMaxWords: 30, onLedgerChange, now: () => 0 });
    await e.describeFrame(SCENES[0], 2, IMAGE);
    expect(onLedgerChange).toHaveBeenCalledTimes(1);
  });
});

describe('a Gemini Nano request that never answers', () => {
  // Seen on Chrome 158: one on-device frame prompt never settled and the job waited for 30 minutes.
  const hangOnDevice: Handler = (mode) =>
    mode === 'only_in_cloud' ? { text: defaultAnswer('frameNote'), source: 'in_cloud' } : new Promise<GenerateResult>(() => {});
  const withTimeout = (provider: FakeProvider, mode: AppMode, confirm?: () => Promise<boolean>) =>
    new DescriptionEngine(provider, { mode, language: 'en', frameMaxWords: 30, confirmCloudFrames: confirm, now: () => 0, deviceTimeoutMs: 20 });

  it('in hybrid mode, stops waiting and asks before sending that frame to the cloud', async () => {
    const provider = new FakeProvider();
    provider.handlers.frameNote = hangOnDevice;
    const confirm = vi.fn(async () => true);
    const e = withTimeout(provider, 'hybrid', confirm);
    await e.startVideo();
    const note = await e.describeFrame(SCENES[0], 2, IMAGE);
    expect(note.source).toBe('in_cloud');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(provider.calls.map((c) => c.mode)).toEqual(['only_on_device', 'only_in_cloud']);
    expect(e.ledger).toMatchObject({ fallbacks: 1, framesInCloud: 1, framesOnDevice: 0 });
    expect(e.ledger.events.at(-1)?.note).toContain('device-timeout');
  });

  it('in hybrid mode, sends nothing when the person keeps frames on the device', async () => {
    const provider = new FakeProvider();
    provider.handlers.frameNote = hangOnDevice;
    const e = withTimeout(provider, 'hybrid', async () => false);
    await e.startVideo();
    await expect(e.describeFrame(SCENES[0], 2, IMAGE)).rejects.toBeInstanceOf(CloudConsentDeclinedError);
    expect(provider.calls.map((c) => c.mode)).toEqual(['only_on_device']);
    expect(e.ledger.framesInCloud).toBe(0);
  });

  it('in private mode, fails that frame without any cloud request', async () => {
    const provider = new FakeProvider();
    provider.handlers.frameNote = hangOnDevice;
    const e = withTimeout(provider, 'private');
    await e.startVideo();
    await expect(e.describeFrame(SCENES[0], 2, IMAGE)).rejects.toBeInstanceOf(DeviceTimeoutError);
    expect(provider.calls.every((c) => c.mode === 'only_on_device')).toBe(true);
    expect(e.ledger).toMatchObject({ failures: 1, framesInCloud: 0, framesMaybeInCloud: 0 });
  });

  it('in private mode, a rewrite that never answers falls back to trimming', async () => {
    const provider = new FakeProvider();
    provider.handlers.fit = () => new Promise<GenerateResult>(() => {});
    const e = withTimeout(provider, 'private');
    await e.startVideo();
    const result = await e.fit('a b c d e f g h', 4);
    expect(result.text).toBe('a b c d.');
  });

  it('leaves cloud-only requests to the SDK timeout', async () => {
    const provider = new FakeProvider();
    provider.handlers.frameNote = () =>
      new Promise<GenerateResult>((resolve) => setTimeout(() => resolve({ text: defaultAnswer('frameNote'), source: 'in_cloud' }), 60));
    const e = withTimeout(provider, 'cloud');
    await e.startVideo();
    const note = await e.describeFrame(SCENES[0], 2, IMAGE);
    expect(note.source).toBe('in_cloud');
  });
});
