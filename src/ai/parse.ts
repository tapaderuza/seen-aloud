/**
 * Both models are asked for JSON with a schema, but small models still wrap it
 * in code fences or add a sentence around it now and then. These parsers
 * accept that and fail loudly only when nothing usable is there.
 */

export class ModelOutputError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'ModelOutputError';
  }
}

/** Finds the first complete JSON object or array in `text`. */
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/giu, '').trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    // fall through to scanning
  }
  for (let i = 0; i < unfenced.length; i++) {
    const open = unfenced[i];
    if (open !== '{' && open !== '[') continue;
    const end = matchingBracket(unfenced, i);
    if (end < 0) continue;
    try {
      return JSON.parse(unfenced.slice(i, end + 1));
    } catch {
      // keep scanning
    }
  }
  throw new ModelOutputError('No JSON found in model output', text);
}

function matchingBracket(text: string, from: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

export interface FrameNoteOutput {
  visual: string;
  onScreenText: string;
}

export function parseFrameNote(text: string): FrameNoteOutput {
  let data: unknown;
  try {
    data = extractJson(text);
  } catch {
    // A plain sentence is still a usable description.
    const plain = tidy(text);
    if (plain) return { visual: plain, onScreenText: '' };
    throw new ModelOutputError('Empty frame description', text);
  }
  const record = asRecord(data);
  const visual = tidy(stringField(record, 'visual') ?? stringField(record, 'description') ?? '');
  if (!visual) throw new ModelOutputError('Frame description has no "visual" text', text);
  return { visual, onScreenText: tidy(stringField(record, 'onScreenText') ?? '') };
}

/** Returns description text per scene id. Ids the model invented are dropped. */
export function parseScript(text: string, knownIds: readonly string[]): Map<string, string> {
  const data = extractJson(text);
  const list = Array.isArray(data) ? data : asRecord(data).cues;
  if (!Array.isArray(list)) throw new ModelOutputError('Script has no "cues" array', text);
  const allowed = new Set(knownIds);
  const out = new Map<string, string>();
  for (const item of list) {
    const record = asRecord(item);
    const id = stringField(record, 'id');
    const cue = stringField(record, 'text');
    if (id && allowed.has(id) && cue !== undefined && !out.has(id)) out.set(id, tidy(cue));
  }
  if (out.size === 0 && knownIds.length > 0) throw new ModelOutputError('Script matched no scene ids', text);
  return out;
}

export function parseFit(text: string): string {
  try {
    const record = asRecord(extractJson(text));
    const value = stringField(record, 'text');
    if (value !== undefined) return tidy(value);
  } catch {
    // fall back to plain text
  }
  const plain = tidy(text);
  if (!plain) throw new ModelOutputError('Empty rewrite', text);
  return plain;
}

/** Removes stray quotes, preambles and whitespace that small models like to add. */
export function tidy(text: string): string {
  return text
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/gu, '')
    .replace(/^(the image shows|in this (frame|image|scene),?|we see)\s+/iu, '')
    .replace(/^\p{Ll}/u, (c) => c.toUpperCase())
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}
