import { CloudConsentDeclinedError, PrivacyGuardError, type DescriptionEngine } from '../ai/engine';
import type { AppSettings } from '../config/settings';
import type { CaptionCue, Cue, CuePlan, Scene, SceneNote, TimeRange } from '../core/types';
import { findSilences, rmsWindows } from '../media/audio';
import { dialogueByScene, gapsFromCaptions } from '../media/gaps';
import { detectScenes } from '../media/scenes';
import { captureFrame, decodeSoundtrack, loadVideo, sampleSignatures } from '../media/video';
import { planCues } from '../track/budget';

export type Stage = 'scenes' | 'pauses' | 'describe' | 'script' | 'done';

export interface AnalysisCallbacks {
  onStage(stage: Stage, detail: string): void;
  onProgress(fraction: number): void;
  onScenes(scenes: Scene[], plans: CuePlan[]): void;
  onNote(note: SceneNote, thumbnailUrl: string): void;
}

export interface AnalysisResult {
  duration: number;
  scenes: Scene[];
  plans: CuePlan[];
  notes: Map<string, SceneNote>;
  cues: Cue[];
  pausesFrom: 'captions' | 'audio' | 'none';
  /** Scenes whose key frame could not be described; their lines are left empty. */
  failedScenes: number;
}

/** When this many scenes in a row fail from the start, the problem is not one bad frame. */
const FAIL_FAST_AFTER = 3;

/** Errors that end the whole job, rather than leaving one scene's line empty. */
function endsTheJob(error: unknown): boolean {
  return (
    error instanceof PrivacyGuardError ||
    error instanceof CloudConsentDeclinedError ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

/**
 * Step 3: one key frame per scene. A frame the model cannot describe (an empty
 * answer, a blocked response, a one-off error) leaves that scene's line empty
 * for the person to write or describe again, instead of losing the whole video.
 */
export async function describeScenes(
  scenes: readonly Scene[],
  engine: Pick<DescriptionEngine, 'describeFrame'>,
  grab: (scene: Scene) => Promise<{ base64: string; thumbnailUrl: string }>,
  callbacks: Pick<AnalysisCallbacks, 'onNote' | 'onProgress'>,
  signal?: AbortSignal,
): Promise<{ notes: Map<string, SceneNote>; failed: number }> {
  const notes = new Map<string, SceneNote>();
  let previous: string | undefined;
  let failed = 0;
  for (const scene of scenes) {
    signal?.throwIfAborted();
    const frame = await grab(scene);
    let note: SceneNote;
    try {
      note = await engine.describeFrame(scene, scenes.length, { mimeType: 'image/jpeg', data: frame.base64 }, previous);
    } catch (error) {
      failed++;
      const everyOneFailed = failed === notes.size + 1;
      if (endsTheJob(error) || failed === scenes.length || (everyOneFailed && failed >= FAIL_FAST_AFTER)) throw error;
      note = { sceneId: scene.id, visual: '', onScreenText: '', source: 'manual' };
    }
    notes.set(scene.id, note);
    if (note.visual) previous = note.visual;
    callbacks.onNote(note, frame.thumbnailUrl);
    callbacks.onProgress(notes.size / scenes.length);
  }
  return { notes, failed };
}

/**
 * The whole job, in four steps:
 * 1. find scene cuts locally (no AI),
 * 2. find pauses in the dialogue (captions, or the soundtrack's quiet stretches),
 * 3. describe one key frame per scene (Gemini Nano first),
 * 4. write the track as one piece (cloud first, text only).
 */
export async function analyzeVideo(
  file: File,
  engine: DescriptionEngine,
  settings: AppSettings,
  callbacks: AnalysisCallbacks,
  captions: CaptionCue[] = [],
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  const url = URL.createObjectURL(file);
  try {
    const video = await loadVideo(url);
    const duration = video.duration;

    callbacks.onStage('scenes', 'Finding scene changes on this computer');
    const signatures = await sampleSignatures(video, settings.sampleIntervalSec, callbacks.onProgress, signal);
    const scenes = detectScenes(signatures, duration, {
      threshold: settings.sceneThreshold,
      minSceneSec: settings.minSceneSec,
      maxSceneSec: settings.maxSceneSec,
    });

    callbacks.onStage('pauses', captions.length ? 'Reading pauses from your captions' : 'Listening for pauses in the dialogue');
    callbacks.onProgress(0);
    let gaps: TimeRange[];
    let pausesFrom: AnalysisResult['pausesFrom'];
    if (captions.length) {
      gaps = gapsFromCaptions(captions, duration);
      pausesFrom = 'captions';
    } else {
      const audio = await decodeSoundtrack(file);
      if (audio) {
        gaps = findSilences(rmsWindows(audio.samples, audio.sampleRate, 0.05), 0.05);
        pausesFrom = 'audio';
      } else {
        gaps = [{ start: 0, end: duration }];
        pausesFrom = 'none';
      }
    }
    callbacks.onProgress(1);
    const plans = planCues(scenes, gaps, settings.wordsPerSecond);
    callbacks.onScenes(scenes, plans);

    callbacks.onStage('describe', `Describing ${scenes.length} scenes`);
    await engine.startVideo();
    const { notes, failed } = await describeScenes(
      scenes,
      engine,
      (scene) => captureFrame(video, scene.keyframeTime),
      callbacks,
      signal,
    );

    callbacks.onStage('script', 'Writing the description track');
    callbacks.onProgress(0);
    const cues = await engine.writeTrack(plans, notes, dialogueByScene(scenes, captions));
    callbacks.onProgress(1);
    callbacks.onStage('done', 'Track ready');
    video.removeAttribute('src');
    video.load();
    return { duration, scenes, plans, notes, cues, pausesFrom, failedScenes: failed };
  } finally {
    URL.revokeObjectURL(url);
  }
}
