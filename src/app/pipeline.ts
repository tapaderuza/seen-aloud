import type { DescriptionEngine } from '../ai/engine';
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
    const notes = new Map<string, SceneNote>();
    let previous: string | undefined;
    for (const scene of scenes) {
      signal?.throwIfAborted();
      const frame = await captureFrame(video, scene.keyframeTime);
      const note = await engine.describeFrame(scene, scenes.length, { mimeType: 'image/jpeg', data: frame.base64 }, previous);
      notes.set(scene.id, note);
      previous = note.visual;
      callbacks.onNote(note, frame.thumbnailUrl);
      callbacks.onProgress(notes.size / scenes.length);
    }

    callbacks.onStage('script', 'Writing the description track');
    callbacks.onProgress(0);
    const cues = await engine.writeTrack(plans, notes, dialogueByScene(scenes, captions));
    callbacks.onProgress(1);
    callbacks.onStage('done', 'Track ready');
    video.removeAttribute('src');
    video.load();
    return { duration, scenes, plans, notes, cues, pausesFrom };
  } finally {
    URL.revokeObjectURL(url);
  }
}
