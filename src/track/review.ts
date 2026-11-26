import { wordOverlap } from '../ai/engine';
import type { Cue, SceneNote } from '../core/types';
import { countWords } from './budget';

/**
 * Local checks on a finished line: no model is asked, so nothing leaves the
 * computer. They do not prove a line is right; they point a person at the lines
 * worth a second look. A line with no flags has passed these checks, nothing more.
 */
export type ReviewFlag = 'empty' | 'only-screen-text' | 'over-budget' | 'number-not-in-notes' | 'repeats-previous';

const NUMBER = /\d+(?:[.,]\d+)?/gu;

export function reviewCue(cue: Cue, note: SceneNote | undefined, previousText: string | undefined): ReviewFlag[] {
  const text = cue.text.trim();
  if (!text) return ['empty'];
  const flags: ReviewFlag[] = [];
  if (/^on screen:/iu.test(text)) flags.push('only-screen-text');
  if (countWords(text) > cue.budgetWords) flags.push('over-budget');
  if (note) {
    // A number the frame notes never mention may have been invented by the script writer.
    const known = new Set(`${note.visual} ${note.onScreenText}`.match(NUMBER) ?? []);
    if ((text.match(NUMBER) ?? []).some((n) => !known.has(n))) flags.push('number-not-in-notes');
  }
  if (previousText && wordOverlap(text, previousText) >= 0.8) flags.push('repeats-previous');
  return flags;
}

const REASON: Record<ReviewFlag, string> = {
  empty: 'no description',
  'only-screen-text': 'reads only on-screen text, not the picture',
  'over-budget': 'longer than its pause',
  'number-not-in-notes': 'a number the frame notes do not show',
  'repeats-previous': 'nearly repeats the previous line',
};

/** Plain words for a badge and its accessible name. */
export function reviewSummary(flags: readonly ReviewFlag[]): string {
  return flags.map((f) => REASON[f]).join('; ');
}
