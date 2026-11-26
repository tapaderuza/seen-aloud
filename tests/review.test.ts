import { describe, expect, it } from 'vitest';
import { DescriptionEngine, wordOverlap, type ModelProvider } from '../src/ai/engine';
import type { Cue, CuePlan, SceneNote } from '../src/core/types';
import { reviewCue, reviewSummary } from '../src/track/review';

const cue = (text: string, budgetWords = 10): Cue => ({ sceneId: 's1', start: 0, end: 4, budgetWords, extended: false, text, source: 'in_cloud' });
const note = (visual: string, onScreenText = ''): SceneNote => ({ sceneId: 's1', visual, onScreenText, source: 'on_device' });

describe('local review of finished lines', () => {
  it('passes a plain, fitting line', () => {
    expect(reviewCue(cue('A woman opens a red door.'), note('A woman opens a red door.'), undefined)).toEqual([]);
  });

  it('flags an empty line, a line that only reads text, and an over-long one', () => {
    expect(reviewCue(cue('  '), note('A door.'), undefined)).toEqual(['empty']);
    expect(reviewCue(cue('On screen: ANA'), note('A blue card.', 'ANA'), undefined)).toEqual(['only-screen-text']);
    expect(reviewCue(cue('one two three four five', 3), undefined, undefined)).toEqual(['over-budget']);
  });

  it('flags a number the frame notes never mention', () => {
    expect(reviewCue(cue('The total drops to 6.18 gigabytes.'), note('A bar chart totals 9 gigabytes.'), undefined)).toEqual(['number-not-in-notes']);
    expect(reviewCue(cue('The total is 9 gigabytes.'), note('A bar chart totals 9 gigabytes.'), undefined)).toEqual([]);
  });

  it('flags a near repeat of the previous line', () => {
    expect(reviewCue(cue('The woman opens the red door.'), undefined, 'The woman opens the red door again.')).toEqual(['repeats-previous']);
  });

  it('says why in plain words', () => {
    expect(reviewSummary(['only-screen-text', 'over-budget'])).toBe('reads only on-screen text, not the picture; longer than its pause');
  });

  it('measures word overlap', () => {
    expect(wordOverlap('a red door', 'a red door')).toBe(1);
    expect(wordOverlap('a red door', 'blue sky')).toBe(0);
  });
});

describe('script lines that drop the picture', () => {
  function provider(script: string): ModelProvider {
    return {
      model: (task) => ({
        generate: async () =>
          task === 'script'
            ? { text: script, source: 'in_cloud' }
            : { text: '{"text":"A blue card reads ANA."}', source: 'in_cloud' },
      }),
      deviceAvailability: async () => 'unsupported',
      prepareDevice: async () => {},
    };
  }
  const plans: CuePlan[] = [
    { sceneId: 's1', start: 0, end: 4, budgetWords: 12, extended: false },
    { sceneId: 's2', start: 4, end: 8, budgetWords: 12, extended: false },
  ];
  const notes = new Map<string, SceneNote>([
    ['s1', { sceneId: 's1', visual: 'A red square moves to the right on white.', onScreenText: '', source: 'in_cloud' }],
    ['s2', { sceneId: 's2', visual: 'A blue square rises on black.', onScreenText: '', source: 'in_cloud' }],
  ]);

  it('uses the frame note when the script leaves a changed scene empty', async () => {
    const e = new DescriptionEngine(provider('{"cues":[{"id":"s1","text":""},{"id":"s2","text":""}]}'), { mode: 'cloud', language: 'en', frameMaxWords: 30 });
    const cues = await e.writeTrack(plans, notes);
    expect(cues.map((c) => c.text)).toEqual(['A red square moves to the right on white.', 'A blue square rises on black.']);
  });

  it('keeps an empty line when the scene looks like the previous one', async () => {
    const same = new Map(notes);
    same.set('s2', { sceneId: 's2', visual: 'A red square moves to the right on white.', onScreenText: '', source: 'in_cloud' });
    const e = new DescriptionEngine(provider('{"cues":[{"id":"s1","text":"A red square slides right."},{"id":"s2","text":""}]}'), { mode: 'cloud', language: 'en', frameMaxWords: 30 });
    const cues = await e.writeTrack(plans, same);
    expect(cues.map((c) => c.text)).toEqual(['A red square slides right.', '']);
  });

  it('replaces a line that only reads on-screen text with the frame note', async () => {
    const withText = new Map(notes);
    withText.set('s1', { sceneId: 's1', visual: 'A blue card fills the screen.', onScreenText: 'ANA', source: 'in_cloud' });
    const e = new DescriptionEngine(provider('{"cues":[{"id":"s1","text":"On screen: ANA"},{"id":"s2","text":"A blue square rises."}]}'), { mode: 'cloud', language: 'en', frameMaxWords: 30 });
    const cues = await e.writeTrack(plans, withText);
    expect(cues[0].text).toBe('A blue card fills the screen. On screen: ANA');
    expect(cues[1].text).toBe('A blue square rises.');
  });
});
