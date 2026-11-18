import { describe, expect, it } from 'vitest';
import type { Cue, Scene } from '../src/core/types';
import { countWords, fits, planCues, speechSeconds, trimToBudget, wordBudget } from '../src/track/budget';
import {
  escapeCueText,
  formatTimestamp,
  parseCaptions,
  parseTimestamp,
  serializeDescriptionsVtt,
  serializeScript,
} from '../src/track/vtt';

function scene(id: string, start: number, end: number): Scene {
  return { id, index: Number(id.slice(1)) - 1, start, end, keyframeTime: start + 1 };
}

function cue(partial: Partial<Cue> & Pick<Cue, 'start' | 'end' | 'text'>): Cue {
  return { sceneId: 's1', budgetWords: 10, extended: false, source: 'on_device', ...partial };
}

describe('word budgets', () => {
  it('counts words regardless of spacing', () => {
    expect(countWords('  a  b\tc ')).toBe(3);
    expect(countWords('')).toBe(0);
  });

  it('allows about two and a half words per second, never fewer than three', () => {
    expect(wordBudget(4)).toBe(10);
    expect(wordBudget(0.5)).toBe(3);
    expect(speechSeconds('one two three four five')).toBe(2);
    expect(fits('one two three', 3)).toBe(true);
    expect(fits('one two three four', 3)).toBe(false);
  });

  it('places each description in the scene pause, or extends it when there is none', () => {
    const plans = planCues([scene('s1', 0, 5), scene('s2', 5, 10)], [{ start: 1, end: 4 }]);
    expect(plans[0]).toEqual({ sceneId: 's1', start: 1, end: 4, budgetWords: 7, extended: false });
    expect(plans[1]).toMatchObject({ sceneId: 's2', start: 5, extended: true, budgetWords: 18 });
    expect(plans[1].end).toBe(10);
  });

  it('trims at a word boundary and closes the sentence', () => {
    expect(trimToBudget('one two three, four five', 3)).toBe('one two three.');
    expect(trimToBudget('Short one.', 5)).toBe('Short one.');
  });
});

describe('timestamps', () => {
  it('formats WebVTT and SRT timestamps', () => {
    expect(formatTimestamp(75.5)).toBe('00:01:15.500');
    expect(formatTimestamp(3661.007)).toBe('01:01:01.007');
    expect(formatTimestamp(1.25, ',')).toBe('00:00:01,250');
    expect(formatTimestamp(-3)).toBe('00:00:00.000');
  });

  it('parses short, long and SRT forms', () => {
    expect(parseTimestamp('01:15.5')).toBe(75.5);
    expect(parseTimestamp('00:01:15,500')).toBe(75.5);
    expect(parseTimestamp('1:02:03.004')).toBeCloseTo(3723.004, 6);
    expect(parseTimestamp('soon')).toBeNaN();
  });
});

describe('WebVTT description tracks', () => {
  it('escapes markup and the cue arrow', () => {
    expect(escapeCueText('a --> b & <c>')).toBe('a → b &amp; &lt;c&gt;');
  });

  it('writes sorted, numbered cues and skips empty ones', () => {
    const vtt = serializeDescriptionsVtt(
      [
        cue({ start: 5, end: 7, text: 'A dog runs in.' }),
        cue({ start: 1, end: 3, text: 'A kitchen at dawn.' }),
        cue({ start: 8, end: 9, text: '   ' }),
      ],
      'Demo',
    );
    expect(vtt).toBe(
      'WEBVTT - Demo\n\n1\n00:00:01.000 --> 00:00:03.000\nA kitchen at dawn.\n\n2\n00:00:05.000 --> 00:00:07.000\nA dog runs in.\n',
    );
  });

  it('notes extended descriptions for other players', () => {
    const vtt = serializeDescriptionsVtt([cue({ start: 0, end: 2, text: 'Long one.', extended: true })]);
    expect(vtt).toContain('NOTE 1 description(s)');
  });

  it('round-trips through the caption parser', () => {
    const cues = [cue({ start: 1.2, end: 3.4, text: 'Fish & chips <hot>' })];
    expect(parseCaptions(serializeDescriptionsVtt(cues))).toEqual([{ start: 1.2, end: 3.4, text: 'Fish & chips <hot>' }]);
  });

  it('writes a plain script that flags extended cues', () => {
    const script = serializeScript([
      cue({ start: 2, end: 3, text: 'Second.' }),
      cue({ start: 0, end: 1, text: 'First.', extended: true }),
    ]);
    expect(script).toBe('[00:00:00.000] (pause video) First.\n[00:00:02.000] Second.');
  });
});

describe('caption parsing', () => {
  it('reads SRT with a byte order mark and Windows line endings', () => {
    const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello there\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n<i>General</i> Kenobi\r\n';
    expect(parseCaptions(srt)).toEqual([
      { start: 1, end: 2.5, text: 'Hello there' },
      { start: 3, end: 4, text: 'General Kenobi' },
    ]);
  });

  it('reads WebVTT with cue settings and multi-line text, skipping broken cues', () => {
    const vtt = 'WEBVTT\n\nNOTE a comment\n\nintro\n00:01.000 --> 00:02.000 line:90% align:center\nTwo\nlines\n\n00:05.000 --> 00:04.000\nBackwards\n';
    expect(parseCaptions(vtt)).toEqual([{ start: 1, end: 2, text: 'Two lines' }]);
  });
});
