import type { CuePlan, Scene, TimeRange } from '../core/types';
import { bestWindowForScene } from '../media/gaps';

/** Describers speak at roughly 150-160 words per minute. */
export const DEFAULT_WORDS_PER_SECOND = 2.5;
/** Ceiling for descriptions that pause the video, so they stay digestible. */
export const EXTENDED_MAX_WORDS = 18;
const MIN_WORDS = 3;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function wordBudget(windowSec: number, wordsPerSecond = DEFAULT_WORDS_PER_SECOND): number {
  return Math.max(MIN_WORDS, Math.floor(windowSec * wordsPerSecond));
}

export function speechSeconds(text: string, wordsPerSecond = DEFAULT_WORDS_PER_SECOND): number {
  return countWords(text) / wordsPerSecond;
}

export function fits(text: string, budgetWords: number): boolean {
  return countWords(text) <= budgetWords;
}

/**
 * Decides where each scene's description is spoken and how long it may be.
 * Scenes without a usable pause get an extended cue at the scene start.
 */
export function planCues(
  scenes: readonly Scene[],
  gaps: readonly TimeRange[],
  wordsPerSecond = DEFAULT_WORDS_PER_SECOND,
): CuePlan[] {
  return scenes.map((scene) => {
    const window = bestWindowForScene(scene, gaps);
    if (window) {
      return {
        sceneId: scene.id,
        start: round2(window.start),
        end: round2(window.end),
        budgetWords: wordBudget(window.end - window.start, wordsPerSecond),
        extended: false,
      };
    }
    const end = Math.min(scene.end, scene.start + EXTENDED_MAX_WORDS / wordsPerSecond);
    return {
      sceneId: scene.id,
      start: round2(scene.start),
      end: round2(Math.max(end, scene.start + 1)),
      budgetWords: EXTENDED_MAX_WORDS,
      extended: true,
    };
  });
}

/** Last-resort trim when no model is available: cut at a word boundary. */
export function trimToBudget(text: string, budgetWords: number): string {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (words.length <= budgetWords) return words.join(' ');
  const cut = words.slice(0, budgetWords).join(' ').replace(/[,;:\-–—]+$/u, '');
  return /[.!?]$/u.test(cut) ? cut : `${cut}.`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
