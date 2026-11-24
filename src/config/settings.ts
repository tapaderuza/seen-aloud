/**
 * Everything worth tuning after launch lives in Firebase Remote Config, with
 * these defaults compiled in so the app works offline and before the first
 * fetch.
 */
export interface AppSettings {
  /** Gemini model used whenever a request runs in the cloud. */
  cloudModel: string;
  /** Tried when the main cloud model keeps failing with a transient error (busy, rate limited). */
  cloudFallbackModel: string;
  sceneThreshold: number;
  sampleIntervalSec: number;
  minSceneSec: number;
  maxSceneSec: number;
  wordsPerSecond: number;
  /** Upper bound for the frame describer's first draft. */
  frameMaxWords: number;
  /** Extra house-style rule appended to every prompt, e.g. "Say 'on screen' before text." */
  styleNotes: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  cloudModel: 'gemini-3.5-flash-lite',
  cloudFallbackModel: 'gemini-3.8-flash',
  sceneThreshold: 0.3,
  sampleIntervalSec: 0.5,
  minSceneSec: 1.5,
  maxSceneSec: 12,
  wordsPerSecond: 2.5,
  frameMaxWords: 30,
  styleNotes: '',
};

export const REMOTE_CONFIG_KEYS: Record<keyof AppSettings, string> = {
  cloudModel: 'cloud_model',
  cloudFallbackModel: 'cloud_fallback_model',
  sceneThreshold: 'scene_threshold',
  sampleIntervalSec: 'sample_interval_sec',
  minSceneSec: 'min_scene_sec',
  maxSceneSec: 'max_scene_sec',
  wordsPerSecond: 'words_per_second',
  frameMaxWords: 'frame_max_words',
  styleNotes: 'style_notes',
};

/** Allowed ranges keep a bad Remote Config value from breaking the pipeline. */
const BOUNDS: Partial<Record<keyof AppSettings, [number, number]>> = {
  sceneThreshold: [0.05, 0.95],
  sampleIntervalSec: [0.1, 5],
  minSceneSec: [0.3, 30],
  maxSceneSec: [2, 120],
  wordsPerSecond: [1, 5],
  frameMaxWords: [8, 80],
};

export function remoteConfigDefaults(): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
    out[REMOTE_CONFIG_KEYS[key]] = DEFAULT_SETTINGS[key];
  }
  return out;
}

/** Builds settings from a getter over Remote Config string values. */
export function settingsFromRemote(get: (remoteKey: string) => string | undefined): AppSettings {
  const settings: AppSettings = { ...DEFAULT_SETTINGS };
  const cloudModel = get(REMOTE_CONFIG_KEYS.cloudModel)?.trim();
  if (cloudModel && /^[a-z0-9.\-]+$/iu.test(cloudModel)) settings.cloudModel = cloudModel;
  const fallbackModel = get(REMOTE_CONFIG_KEYS.cloudFallbackModel)?.trim();
  if (fallbackModel !== undefined && /^[a-z0-9.\-]*$/iu.test(fallbackModel)) {
    // An empty value switches the fallback off.
    settings.cloudFallbackModel = fallbackModel;
  }
  settings.styleNotes = (get(REMOTE_CONFIG_KEYS.styleNotes) ?? '').trim().slice(0, 300);

  for (const [key, [min, max]] of Object.entries(BOUNDS) as Array<[keyof AppSettings, [number, number]]>) {
    const raw = get(REMOTE_CONFIG_KEYS[key]);
    if (raw === undefined || raw.trim() === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= min && value <= max) {
      (settings as unknown as Record<string, number>)[key] = value;
    }
  }
  if (settings.minSceneSec >= settings.maxSceneSec) {
    settings.minSceneSec = DEFAULT_SETTINGS.minSceneSec;
    settings.maxSceneSec = DEFAULT_SETTINGS.maxSceneSec;
  }
  return settings;
}
