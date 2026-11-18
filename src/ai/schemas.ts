/**
 * One JSON Schema per task, shared by both inference paths: Chrome's Prompt
 * API receives it as `responseConstraint` and the Gemini API as
 * `responseJsonSchema`, so on-device and cloud answers have the same shape.
 */

export const FRAME_NOTE_SCHEMA = {
  type: 'object',
  properties: {
    visual: { type: 'string', description: 'What is visible, present tense, no preamble.' },
    onScreenText: { type: 'string', description: 'Important text on screen, verbatim, or empty.' },
  },
  required: ['visual', 'onScreenText'],
  additionalProperties: false,
} as const;

export const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    cues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['cues'],
  additionalProperties: false,
} as const;

export const FIT_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
  },
  required: ['text'],
  additionalProperties: false,
} as const;
