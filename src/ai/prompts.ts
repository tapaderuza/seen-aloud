import type { DescriptionLanguage } from '../core/types';
import { formatTimestamp } from '../track/vtt';

/**
 * Prompts carry their own instructions instead of a system instruction:
 * Firebase AI Logic does not pass system instructions to Chrome's on-device
 * model, and both paths must behave the same.
 */

const LANGUAGE_NAMES: Record<DescriptionLanguage, string> = {
  en: 'English',
  es: 'Spanish (Spain)',
};

/** Distilled from common audio description guidelines (describe, don't interpret). */
export const CORE_RULES = [
  'Describe only what is visible: who, what they do, where. Use present tense and third person.',
  'Be specific and concrete: colours, objects, actions, facial expressions only when clearly visible.',
  'Never start with "The image shows", "We see", "In this frame" or similar.',
  'Do not guess names, identities, ages, brands or anything you cannot see.',
  'Prioritise what changed and what matters to follow the story.',
];

export interface FrameNoteInput {
  sceneNumber: number;
  sceneCount: number;
  start: number;
  end: number;
  maxWords: number;
  language: DescriptionLanguage;
  previousVisual?: string;
  styleNotes?: string;
}

export function frameNotePrompt(input: FrameNoteInput): string {
  const lines = [
    'You are a professional audio describer writing for blind and low-vision viewers.',
    `Look at this still frame from scene ${input.sceneNumber} of ${input.sceneCount} of a video (${formatTimestamp(input.start)} to ${formatTimestamp(input.end)}).`,
  ];
  if (input.previousVisual) {
    lines.push(
      `The previous scene was described as: "${clean(input.previousVisual)}".`,
      'Focus on what is new. If the same person or place continues, say so briefly ("the same woman").',
    );
  }
  lines.push(
    'Rules:',
    ...CORE_RULES.map((r) => `- ${r}`),
    '- Copy important on-screen text exactly (titles, signs, labels, captions burned into the video).',
    `- "visual" must be at most ${input.maxWords} words.`,
  );
  if (input.styleNotes) lines.push(`- ${clean(input.styleNotes)}`);
  lines.push(
    `Write in ${LANGUAGE_NAMES[input.language]}.`,
    'Reply only with JSON: {"visual": "...", "onScreenText": "..."}. Use "" for onScreenText when there is none.',
  );
  return lines.join('\n');
}

export interface ScriptSceneInput {
  id: string;
  start: number;
  end: number;
  budgetWords: number;
  extended: boolean;
  visual: string;
  onScreenText: string;
  dialogue?: string;
}

export function scriptPrompt(
  scenes: readonly ScriptSceneInput[],
  language: DescriptionLanguage,
  styleNotes?: string,
): string {
  const payload = scenes.map((s) => ({
    id: s.id,
    time: `${formatTimestamp(s.start)}-${formatTimestamp(s.end)}`,
    maxWords: s.budgetWords,
    notes: clean(s.visual),
    onScreenText: clean(s.onScreenText),
    ...(s.dialogue ? { dialogueNearby: clean(s.dialogue) } : {}),
  }));
  const lines = [
    'You are a professional audio describer finishing the audio description track of a video.',
    'Each scene below has notes from a frame-by-frame describer, the on-screen text, and the words that fit in the pause where the description will be spoken (maxWords, a hard limit).',
    'Write one description per scene so the track reads as one coherent narration:',
    '- Introduce each person once with a short visual identifier ("a woman in a red apron"), then refer back consistently ("the woman").',
    '- Do not repeat what the previous description or the dialogue already says.',
    '- Read important on-screen text after the description, introduced with "On screen:". Use "On screen:" only before words that are literally written in the video (onScreenText), never before a description of what is visible.',
    '- If a scene adds nothing new, return an empty string for it.',
    ...CORE_RULES.map((r) => `- ${r}`),
  ];
  if (styleNotes) lines.push(`- ${clean(styleNotes)}`);
  lines.push(
    `Write in ${LANGUAGE_NAMES[language]}.`,
    `Scenes: ${JSON.stringify(payload)}`,
    'Reply only with JSON: {"cues": [{"id": "s1", "text": "..."}]}, one entry per scene id, in order.',
  );
  return lines.join('\n');
}

export interface FitInput {
  text: string;
  budgetWords: number;
  language: DescriptionLanguage;
  previousText?: string;
}

export function fitPrompt(input: FitInput): string {
  const lines = [
    'You are a professional audio describer.',
    `Rewrite this description in at most ${input.budgetWords} words so it fits a pause in the dialogue.`,
    'Keep the most important visual information: the action first, then who, then where. Present tense.',
  ];
  if (input.previousText) {
    lines.push(`The description before it was: "${clean(input.previousText)}". Do not repeat it.`);
  }
  lines.push(
    `Write in ${LANGUAGE_NAMES[input.language]}.`,
    `Description: "${clean(input.text)}"`,
    'Reply only with JSON: {"text": "..."}',
  );
  return lines.join('\n');
}

/** Keeps quotes and line breaks in user or model text from breaking the prompt structure. */
function clean(text: string): string {
  return text.replace(/\s+/gu, ' ').replace(/"/gu, "'").trim();
}
