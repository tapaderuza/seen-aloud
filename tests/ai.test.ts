import { describe, expect, it } from 'vitest';
import { extractJson, ModelOutputError, parseFit, parseFrameNote, parseScript, tidy } from '../src/ai/parse';
import { fitPrompt, frameNotePrompt, scriptPrompt } from '../src/ai/prompts';
import { FIT_SCHEMA, FRAME_NOTE_SCHEMA, SCRIPT_SCHEMA } from '../src/ai/schemas';
import { DEFAULT_SETTINGS, remoteConfigDefaults, settingsFromRemote } from '../src/config/settings';

describe('extractJson', () => {
  it('reads fenced JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('finds JSON wrapped in chatter', () => {
    expect(extractJson('Sure! {"visual":"A dog"} Hope this helps.')).toEqual({ visual: 'A dog' });
  });

  it('is not fooled by brackets inside strings', () => {
    expect(extractJson('x {"t":"a } b ] c"} y')).toEqual({ t: 'a } b ] c' });
  });

  it('throws a typed error when there is no JSON', () => {
    expect(() => extractJson('nothing here')).toThrow(ModelOutputError);
  });
});

describe('model output parsers', () => {
  it('accepts a plain sentence as a frame description', () => {
    expect(parseFrameNote('The image shows a red car parked by a fence.')).toEqual({
      visual: 'A red car parked by a fence.',
      onScreenText: '',
    });
  });

  it('reads the structured frame note, including the "description" alias', () => {
    expect(parseFrameNote('{"visual":"a chef chops onions","onScreenText":"Step 1"}')).toEqual({
      visual: 'A chef chops onions',
      onScreenText: 'Step 1',
    });
    expect(parseFrameNote('{"description":"A cat sleeps."}').visual).toBe('A cat sleeps.');
  });

  it('rejects a frame note without any description', () => {
    expect(() => parseFrameNote('{"onScreenText":"Hi"}')).toThrow(ModelOutputError);
  });

  it('keeps only known scene ids, first answer wins', () => {
    const map = parseScript(
      '{"cues":[{"id":"s1","text":"One"},{"id":"s9","text":"Ghost"},{"id":"s1","text":"Dup"},{"id":"s2","text":""}]}',
      ['s1', 's2'],
    );
    expect([...map]).toEqual([
      ['s1', 'One'],
      ['s2', ''],
    ]);
  });

  it('accepts a bare array of cues', () => {
    expect(parseScript('[{"id":"s1","text":"One"}]', ['s1']).get('s1')).toBe('One');
  });

  it('fails when the script matches no scene', () => {
    expect(() => parseScript('{"cues":[{"id":"x","text":"?"}]}', ['s1'])).toThrow(ModelOutputError);
  });

  it('reads rewrites in JSON or plain text', () => {
    expect(parseFit('{"text":"A man waves."}')).toBe('A man waves.');
    expect(parseFit('"a man waves."')).toBe('A man waves.');
  });

  it('cleans quotes, preambles and capitalisation', () => {
    expect(tidy('  "we see  a boat."  ')).toBe('A boat.');
    expect(tidy('In this frame, two kids play.')).toBe('Two kids play.');
  });
});

describe('prompts', () => {
  it('asks the frame describer for JSON within the word limit, in the chosen language', () => {
    const prompt = frameNotePrompt({
      sceneNumber: 2,
      sceneCount: 5,
      start: 4,
      end: 9,
      maxWords: 25,
      language: 'es',
      previousVisual: 'A man says "hello"\nand waves',
    });
    expect(prompt).toContain('scene 2 of 5');
    expect(prompt).toContain('at most 25 words');
    expect(prompt).toContain('Spanish');
    expect(prompt).toContain(`"A man says 'hello' and waves"`);
    expect(prompt).toContain('{"visual": "...", "onScreenText": "..."}');
  });

  it('gives the script writer every scene with its budget, and dialogue only when known', () => {
    const prompt = scriptPrompt(
      [
        { id: 's1', start: 0, end: 4, budgetWords: 8, extended: false, visual: 'A kitchen.', onScreenText: '' },
        {
          id: 's2',
          start: 4,
          end: 9,
          budgetWords: 5,
          extended: true,
          visual: 'A chef.',
          onScreenText: 'Chef Ana',
          dialogue: 'Hi!',
        },
      ],
      'en',
    );
    expect(prompt).toContain('"id":"s1"');
    expect(prompt).toContain('"maxWords":5');
    expect(prompt).toContain('"dialogueNearby":"Hi!"');
    expect(prompt.match(/dialogueNearby/gu)).toHaveLength(1);
  });

  it('asks for a rewrite under the budget without repeating the previous line', () => {
    const prompt = fitPrompt({ text: 'Long text', budgetWords: 6, language: 'en', previousText: 'Before' });
    expect(prompt).toContain('at most 6 words');
    expect(prompt).toContain('"Before"');
  });
});

describe('schemas', () => {
  it('require every field the parsers rely on', () => {
    expect(FRAME_NOTE_SCHEMA.required).toEqual(['visual', 'onScreenText']);
    expect(SCRIPT_SCHEMA.properties.cues.items.required).toEqual(['id', 'text']);
    expect(FIT_SCHEMA.required).toEqual(['text']);
  });
});

describe('Remote Config settings', () => {
  it('exposes every setting as a default', () => {
    const defaults = remoteConfigDefaults();
    expect(defaults.cloud_model).toBe(DEFAULT_SETTINGS.cloudModel);
    expect(Object.keys(defaults)).toHaveLength(Object.keys(DEFAULT_SETTINGS).length);
  });

  it('applies valid values and ignores broken ones', () => {
    const values: Record<string, string> = {
      cloud_model: 'gemini-3.8-flash',
      scene_threshold: '0.4',
      words_per_second: 'fast',
      frame_max_words: '500',
      style_notes: '  Say "on screen" before text.  ',
    };
    const settings = settingsFromRemote((key) => values[key]);
    expect(settings.cloudModel).toBe('gemini-3.8-flash');
    expect(settings.sceneThreshold).toBe(0.4);
    expect(settings.wordsPerSecond).toBe(DEFAULT_SETTINGS.wordsPerSecond);
    expect(settings.frameMaxWords).toBe(DEFAULT_SETTINGS.frameMaxWords);
    expect(settings.styleNotes).toBe('Say "on screen" before text.');
  });

  it('rejects unsafe model names and inverted scene lengths', () => {
    const values: Record<string, string> = {
      cloud_model: 'gemini/../../evil',
      min_scene_sec: '20',
      max_scene_sec: '10',
    };
    const settings = settingsFromRemote((key) => values[key]);
    expect(settings.cloudModel).toBe(DEFAULT_SETTINGS.cloudModel);
    expect(settings.minSceneSec).toBe(DEFAULT_SETTINGS.minSceneSec);
    expect(settings.maxSceneSec).toBe(DEFAULT_SETTINGS.maxSceneSec);
  });
});
