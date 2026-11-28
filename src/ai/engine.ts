import type { Cue, CuePlan, DescriptionLanguage, Scene, SceneNote, TextSource } from '../core/types';
import { countWords, trimToBudget } from '../track/budget';
import { parseFit, parseFrameNote, parseScript } from './parse';
import { fitPrompt, frameNotePrompt, scriptPrompt, type ScriptSceneInput } from './prompts';
import { MASK_NOTE, SensitiveMasker } from './sensitive';

/** What the person chooses in the header. */
export type AppMode = 'hybrid' | 'private' | 'cloud';
export type Task = 'frameNote' | 'script' | 'fit';
/** Same values as Firebase AI Logic's `InferenceMode`. */
export type InferenceModeValue = 'prefer_on_device' | 'only_on_device' | 'prefer_in_cloud' | 'only_in_cloud';
/** Chrome Prompt API availability, plus `unsupported` when the API does not exist at all. */
export type DeviceAvailability = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available';
export type InferenceSourceValue = 'on_device' | 'in_cloud';

export type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'inlineData'; inlineData: { mimeType: 'image/jpeg' | 'image/png'; data: string } };

export interface GenerateResult {
  text: string;
  source: InferenceSourceValue;
}

export interface GenerateHooks {
  /** A transient cloud error is about to be retried: one inference, one more network request. */
  onRetry?: (step: 'same-model' | 'fallback-model', error: unknown) => void;
}

export interface TaskModel {
  generate(parts: PromptPart[], hooks?: GenerateHooks): Promise<GenerateResult>;
}

/** The seam between this engine and Firebase AI Logic (see firebaseProvider.ts). */
export interface ModelProvider {
  model(task: Task, mode: InferenceModeValue, language: DescriptionLanguage): TaskModel;
  deviceAvailability(language: DescriptionLanguage): Promise<DeviceAvailability>;
  prepareDevice(language: DescriptionLanguage, onProgress: (fraction: number) => void): Promise<void>;
}

/**
 * The hybrid policy, per task:
 * - frame notes and rewrites run on the device first: there are many of them,
 *   each is small, and the frames are the private part of the video;
 * - the script pass prefers the cloud: it needs the whole video's notes at
 *   once (more than Gemini Nano's context comfortably holds) and only text is
 *   sent, never pixels.
 * Private mode pins everything to the device; cloud mode pins it to the cloud.
 */
export function inferenceModeFor(task: Task, mode: AppMode): InferenceModeValue {
  if (mode === 'private') return 'only_on_device';
  if (mode === 'cloud') return 'only_in_cloud';
  return task === 'script' ? 'prefer_in_cloud' : 'prefer_on_device';
}

export class PrivacyGuardError extends Error {
  constructor(readonly availability: DeviceAvailability) {
    super(
      availability === 'unsupported'
        ? 'Private mode needs Gemini Nano, and this browser has no on-device model. Nothing was sent to the cloud.'
        : `Private mode needs Gemini Nano, which is ${availability} on this device. Nothing was sent to the cloud.`,
    );
    this.name = 'PrivacyGuardError';
  }
}

/**
 * Gemini Nano accepted a request and did not answer in time. Seen on Chrome 158:
 * one frame prompt in a run never settled, which left the whole job waiting.
 * The SDK passes no abort signal to the on-device prompt, so the app stops waiting.
 */
export class DeviceTimeoutError extends Error {
  readonly code = 'device-timeout';
  constructor(readonly ms: number) {
    super(`Gemini Nano did not answer within ${Math.round(ms / 1000)} seconds.`);
    this.name = 'DeviceTimeoutError';
  }
}

/** Generous: the first frame on a 4 GB GPU took 67 s, including loading the model. */
export const DEFAULT_DEVICE_TIMEOUT_MS = 180_000;

export class CloudConsentDeclinedError extends Error {
  constructor() {
    super('You chose to keep frames on this device. Switch to private mode once Gemini Nano is ready, or allow the cloud.');
    this.name = 'CloudConsentDeclinedError';
  }
}

export interface LedgerEvent {
  task: Task;
  /** Null for notes that are not a model call (for example, a skipped step). */
  source: InferenceSourceValue | null;
  ms: number;
  note?: string;
}

export interface Ledger {
  onDevice: number;
  inCloud: number;
  /** Frames described by Gemini Nano: pixels that never left the computer. */
  framesOnDevice: number;
  /** Frames sent to the cloud model. The UI shows this number prominently. */
  framesInCloud: number;
  /**
   * Frame requests that failed after they may have reached the cloud (a busy
   * model, App Check, a timeout). The pixels may have left, so the UI counts them.
   */
  framesMaybeInCloud: number;
  /** Times a request failed on one side and was retried on the other. */
  fallbacks: number;
  /** Extra cloud requests after a busy or rate-limited answer (same model, then the fallback model). */
  retries: number;
  /** Inferences that ended in an error after every retry and fallback. */
  failures: number;
  /** Values that looked like personal data, masked before a text request that may reach the cloud. */
  masked: number;
  events: LedgerEvent[];
}

export function emptyLedger(): Ledger {
  return {
    onDevice: 0,
    inCloud: 0,
    framesOnDevice: 0,
    framesInCloud: 0,
    framesMaybeInCloud: 0,
    fallbacks: 0,
    retries: 0,
    failures: 0,
    masked: 0,
    events: [],
  };
}

export interface EngineOptions {
  mode: AppMode;
  language: DescriptionLanguage;
  frameMaxWords: number;
  styleNotes?: string;
  /**
   * Asked once per video before the first frame would leave the device in
   * hybrid mode (Gemini Nano missing or failing). Cloud mode is consent itself.
   */
  confirmCloudFrames?: () => Promise<boolean>;
  onLedgerChange?: (ledger: Ledger) => void;
  now?: () => number;
  /** How long a request that may run on Gemini Nano can take before it counts as failed. */
  deviceTimeoutMs?: number;
}

export interface FrameImage {
  mimeType: 'image/jpeg' | 'image/png';
  /** Base64 without the data: prefix. */
  data: string;
}

export class DescriptionEngine {
  readonly ledger: Ledger = emptyLedger();
  private cloudFramesAllowed: boolean | null = null;
  private availability: DeviceAvailability | null = null;

  constructor(
    private readonly provider: ModelProvider,
    private options: EngineOptions,
  ) {}

  get mode(): AppMode {
    return this.options.mode;
  }

  update(changes: Partial<EngineOptions>): void {
    if (changes.mode && changes.mode !== this.options.mode) this.cloudFramesAllowed = null;
    this.options = { ...this.options, ...changes };
    if (changes.language) this.availability = null;
  }

  /**
   * Call when a new video is opened: re-checks the device, asks for consent
   * again, and starts a fresh ledger, so "Where the AI ran" and a saved track
   * count this video only.
   */
  async startVideo(): Promise<DeviceAvailability> {
    this.cloudFramesAllowed = null;
    Object.assign(this.ledger, emptyLedger());
    this.options.onLedgerChange?.(this.ledger);
    return this.refreshAvailability();
  }

  async refreshAvailability(): Promise<DeviceAvailability> {
    try {
      this.availability = await this.provider.deviceAvailability(this.options.language);
    } catch {
      this.availability = 'unsupported';
    }
    return this.availability;
  }

  async describeFrame(
    scene: Scene,
    sceneCount: number,
    image: FrameImage,
    previousVisual?: string,
  ): Promise<SceneNote> {
    const availability = this.availability ?? (await this.refreshAvailability());
    const deviceReady = availability === 'available';

    // Firebase AI Logic quietly uses the cloud when Chrome has no
    // LanguageModel at all, even in ONLY_ON_DEVICE mode. Private mode is a
    // promise to the user, so it is enforced here before any request.
    if (this.options.mode === 'private' && !deviceReady) throw new PrivacyGuardError(availability);
    if (this.options.mode === 'hybrid' && !deviceReady) await this.ensureCloudFramesAllowed();

    const prompt = frameNotePrompt({
      sceneNumber: scene.index + 1,
      sceneCount,
      start: scene.start,
      end: scene.end,
      maxWords: this.options.frameMaxWords,
      language: this.options.language,
      previousVisual,
      styleNotes: this.options.styleNotes,
    });
    // Until the person has said yes, a frame may only go to Gemini Nano.
    // PREFER_ON_DEVICE re-checks availability inside the SDK and would quietly
    // use the cloud if Nano went away after `availability` was read; with
    // ONLY_ON_DEVICE that fails instead, and `run` asks before retrying in the cloud.
    const pinToDevice = this.options.mode === 'hybrid' && deviceReady && this.cloudFramesAllowed !== true;
    const result = await this.run(
      'frameNote',
      [
        { type: 'text', text: prompt },
        { type: 'inlineData', inlineData: image },
      ],
      { carriesImage: true, deviceReady },
      pinToDevice ? 'only_on_device' : undefined,
    );
    const parsed = parseFrameNote(result.text);
    return { sceneId: scene.id, visual: parsed.visual, onScreenText: parsed.onScreenText, source: result.source };
  }

  /**
   * Turns frame notes into the final track. One cloud call sees every scene
   * (coherent references, no repetition); if that is not possible (private
   * mode, offline, quota) each scene is finished on the device instead.
   */
  async writeTrack(
    plans: readonly CuePlan[],
    notes: ReadonlyMap<string, SceneNote>,
    dialogue: ReadonlyMap<string, string> = new Map(),
  ): Promise<Cue[]> {
    const usable = plans.filter((p) => notes.has(p.sceneId));
    // A scene whose frame could not be described has no notes: the script
    // writer must not invent a description for it. Its line stays empty.
    const scriptable = usable.filter((p) => notes.get(p.sceneId)!.visual.trim());
    let scripted: Map<string, string> | null = null;
    let scriptSource: InferenceSourceValue = 'in_cloud';

    if (this.options.mode !== 'private' && scriptable.length > 0) {
      // Text read off the frames or the captions may hold personal data. It is masked before this
      // request (which may reach the cloud) and put back on this computer in each finished line.
      const masker = new SensitiveMasker();
      const inputs: ScriptSceneInput[] = scriptable.map((p) => {
        const note = notes.get(p.sceneId)!;
        const lines = dialogue.get(p.sceneId);
        return {
          id: p.sceneId,
          start: p.start,
          end: p.end,
          budgetWords: p.budgetWords,
          extended: p.extended,
          visual: masker.mask(note.visual),
          onScreenText: masker.mask(note.onScreenText),
          dialogue: lines === undefined ? undefined : masker.mask(lines),
        };
      });
      this.countMasked('script', masker.count);
      try {
        const prompt = scriptPrompt(inputs, this.options.language, this.options.styleNotes);
        const result = await this.run(
          'script',
          [{ type: 'text', text: masker.count ? `${prompt}\n\n${MASK_NOTE}` : prompt }],
          { carriesImage: false, deviceReady: this.availability === 'available' },
        );
        scripted = parseScript(
          result.text,
          scriptable.map((p) => p.sceneId),
        );
        for (const [id, line] of scripted ?? []) scripted!.set(id, masker.restore(line));
        scriptSource = result.source;
      } catch (error) {
        this.note('script', `script pass failed (${errorName(error)}), finishing scene by scene`);
        scripted = null;
      }
    }

    const cues: Cue[] = [];
    let previous: string | undefined;
    let previousNote: SceneNote | undefined;
    for (const plan of usable) {
      const note = notes.get(plan.sceneId)!;
      let text: string;
      let source: TextSource;
      const line = scripted?.get(plan.sceneId);
      // The script writer may skip a scene ("adds nothing new") or read only its on-screen
      // text. When the frame shows something the previous one did not, that drops real
      // picture information, so the scene's own frame note is used instead.
      const dropsPicture =
        line !== undefined &&
        note.visual.trim() !== '' &&
        ((line.trim() === '' && !sameScene(note, previousNote)) || /^on screen:/iu.test(line.trim()));
      if (line !== undefined && !dropsPicture) {
        text = line;
        source = scriptSource;
      } else {
        text = withScreenText(note);
        source = note.source;
      }
      previousNote = note;
      if (text && countWords(text) > plan.budgetWords) {
        const fitted = await this.fit(text, plan.budgetWords, previous);
        text = fitted.text;
        source = fitted.source ?? source;
      }
      cues.push({ ...plan, text, source });
      if (text) previous = text;
    }
    return cues;
  }

  /** Shortens one description to its word budget, on the device when possible. */
  async fit(
    text: string,
    budgetWords: number,
    previousText?: string,
  ): Promise<{ text: string; source?: InferenceSourceValue }> {
    if (countWords(text) <= budgetWords) return { text };
    const deviceReady = this.availability === 'available';
    if (this.options.mode === 'private' && !deviceReady) return { text: trimToBudget(text, budgetWords) };
    // A rewrite may reach the cloud outside Private mode: mask personal-looking data first.
    const masker = new SensitiveMasker();
    const mask = (s: string | undefined) => (this.options.mode === 'private' || s === undefined ? s : masker.mask(s));
    const prompt = fitPrompt({ text: mask(text)!, budgetWords, language: this.options.language, previousText: mask(previousText) });
    this.countMasked('fit', masker.count);
    try {
      const result = await this.run(
        'fit',
        [{ type: 'text', text: masker.count ? `${prompt}\n\n${MASK_NOTE}` : prompt }],
        { carriesImage: false, deviceReady },
      );
      const rewritten = masker.restore(parseFit(result.text));
      return { text: trimToBudget(rewritten, budgetWords), source: result.source };
    } catch {
      return { text: trimToBudget(text, budgetWords) };
    }
  }

  async prepareDevice(onProgress: (fraction: number) => void): Promise<DeviceAvailability> {
    await this.provider.prepareDevice(this.options.language, onProgress);
    return this.refreshAvailability();
  }

  private async run(
    task: Task,
    parts: PromptPart[],
    context: { carriesImage: boolean; deviceReady: boolean },
    modeOverride?: InferenceModeValue,
  ): Promise<GenerateResult> {
    const mode = modeOverride ?? inferenceModeFor(task, this.options.mode);
    const now = this.options.now ?? (() => performance.now());
    const started = now();
    const hooks: GenerateHooks = {
      onRetry: (step, error) => {
        this.ledger.retries++;
        const where = step === 'same-model' ? 'the same model' : 'the fallback model';
        this.pushEvent({ task, source: null, ms: 0, note: `cloud busy (${errorName(error)}), sent again to ${where}` });
      },
    };
    try {
      const request = this.provider.model(task, mode, this.options.language).generate(parts, hooks);
      // Only cloud-pinned requests are left to the SDK's own network timeout.
      const result =
        mode === 'only_in_cloud'
          ? await request
          : await withTimeout(request, this.options.deviceTimeoutMs ?? DEFAULT_DEVICE_TIMEOUT_MS);
      this.record(task, result.source, now() - started, context.carriesImage);
      return result;
    } catch (error) {
      // The SDK only falls back when Nano is unavailable before the call. If
      // Nano accepted the request and then failed (or, pinned to the device in
      // hybrid mode, was gone), retry in the cloud here, with the same consent
      // rules for images.
      const deviceFirst = mode === 'prefer_on_device' || (mode === 'only_on_device' && this.options.mode === 'hybrid');
      if (deviceFirst && context.deviceReady) {
        if (context.carriesImage) await this.ensureCloudFramesAllowed();
        let result: GenerateResult;
        try {
          result = await this.provider.model(task, 'only_in_cloud', this.options.language).generate(parts, hooks);
        } catch (cloudError) {
          this.fail(task, cloudError, context.carriesImage);
          throw cloudError;
        }
        this.ledger.fallbacks++;
        this.record(task, result.source, now() - started, context.carriesImage, `on-device failed (${errorName(error)}), retried in the cloud`);
        return result;
      }
      // Anything but a device-only request may have reached the cloud before it failed.
      this.fail(task, error, context.carriesImage && mode !== 'only_on_device');
      throw error;
    }
  }

  /** An inference that failed for good. A frame request that could have reached the cloud counts as having left. */
  private fail(task: Task, error: unknown, frameMayHaveLeft: boolean): void {
    this.ledger.failures++;
    if (frameMayHaveLeft) this.ledger.framesMaybeInCloud++;
    const note = frameMayHaveLeft
      ? `failed after it may have reached the cloud (${errorName(error)})`
      : `failed (${errorName(error)})`;
    this.pushEvent({ task, source: null, ms: 0, note });
  }

  private async ensureCloudFramesAllowed(): Promise<void> {
    if (this.options.mode === 'cloud') return;
    if (this.options.mode === 'private') throw new PrivacyGuardError(this.availability ?? 'unsupported');
    if (this.cloudFramesAllowed === null) {
      // No way to ask means no consent: frames stay on the device.
      this.cloudFramesAllowed = this.options.confirmCloudFrames ? await this.options.confirmCloudFrames() : false;
    }
    if (!this.cloudFramesAllowed) throw new CloudConsentDeclinedError();
  }

  private record(task: Task, source: InferenceSourceValue, ms: number, carriesImage: boolean, note?: string): void {
    if (source === 'on_device') this.ledger.onDevice++;
    else this.ledger.inCloud++;
    if (carriesImage) {
      if (source === 'on_device') this.ledger.framesOnDevice++;
      else this.ledger.framesInCloud++;
    }
    this.pushEvent({ task, source, ms: Math.round(ms), note });
  }

  private countMasked(task: Task, n: number): void {
    if (n === 0) return;
    this.ledger.masked += n;
    this.pushEvent({ task, source: null, ms: 0, note: `${n} personal-looking value${n === 1 ? '' : 's'} masked before the request` });
  }

  private note(task: Task, note: string): void {
    this.ledger.fallbacks++;
    this.pushEvent({ task, source: null, ms: 0, note });
  }

  private pushEvent(event: LedgerEvent): void {
    this.ledger.events.push(event);
    if (this.ledger.events.length > 200) this.ledger.events.shift();
    this.options.onLedgerChange?.(this.ledger);
  }
}

/** Rejects with DeviceTimeoutError when `request` has not settled after `ms`. */
function withTimeout<T>(request: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeviceTimeoutError(ms)), ms);
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

/** Two frame notes that say mostly the same words describe the same picture. */
function sameScene(note: SceneNote, previous: SceneNote | undefined): boolean {
  if (!previous) return false;
  return wordOverlap(`${note.visual} ${note.onScreenText}`, `${previous.visual} ${previous.onScreenText}`) >= 0.6;
}

/** Jaccard overlap of the lowercase word sets of two texts, from 0 to 1. */
export function wordOverlap(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const x = words(a);
  const y = words(b);
  if (x.size === 0 && y.size === 0) return 1;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

function withScreenText(note: SceneNote): string {
  if (!note.onScreenText) return note.visual;
  const label = /[.!?]$/u.test(note.visual) ? '' : '.';
  return `${note.visual}${label} On screen: ${note.onScreenText}`;
}

function errorName(error: unknown): string {
  if (error instanceof Error) return (error as Error & { code?: string }).code ?? error.name;
  return 'error';
}
