import type { CaptionCue, Cue } from '../core/types';

/** 75.5 -> "00:01:15.500" */
export function formatTimestamp(seconds: number, separator: '.' | ',' = '.'): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${separator}${pad(ms, 3)}`;
}

/** Parses "01:15.5", "00:01:15.500" or SRT "00:01:15,500". Returns NaN when it is not a timestamp. */
export function parseTimestamp(value: string): number {
  const match = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/u.exec(value);
  if (!match) return Number.NaN;
  const [, h, m, s, frac] = match;
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + ms / 1000;
}

/** Text inside a cue must not contain "-->" and needs &, < and > escaped. */
export function escapeCueText(text: string): string {
  return text
    .replace(/-->/gu, '→')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/\r?\n\s*\r?\n/gu, '\n')
    .trim();
}

export function unescapeCueText(text: string): string {
  return text
    .replace(/<[^>]+>/gu, '')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&');
}

/**
 * A WebVTT file meant for `<track kind="descriptions">`. Players and screen
 * readers that support description tracks can read it; Seen Aloud's own
 * player voices it.
 */
export function serializeDescriptionsVtt(cues: readonly Cue[], title?: string): string {
  const header = title ? `WEBVTT - ${escapeCueText(title).replace(/\n/gu, ' ')}` : 'WEBVTT';
  const body = [...cues]
    .filter((c) => c.text.trim().length > 0)
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${escapeCueText(c.text)}`);
  const extended = cues.filter((c) => c.extended && c.text.trim()).length;
  const note = extended
    ? `NOTE ${extended} description(s) are longer than the pause they sit in. Seen Aloud's player pauses the video for them (extended audio description).\n\n`
    : '';
  return `${header}\n\n${note}${body.join('\n\n')}\n`;
}

/** A plain script for human describers or voice actors. */
export function serializeScript(cues: readonly Cue[]): string {
  return [...cues]
    .filter((c) => c.text.trim().length > 0)
    .sort((a, b) => a.start - b.start)
    .map((c) => `[${formatTimestamp(c.start)}]${c.extended ? ' (pause video)' : ''} ${c.text.trim()}`)
    .join('\n');
}

/** Reads captions or subtitles in WebVTT or SRT. Unknown blocks are skipped. */
export function parseCaptions(source: string): CaptionCue[] {
  const text = source.replace(/^﻿/u, '').replace(/\r\n?/gu, '\n');
  const blocks = text.split(/\n{2,}/u);
  const cues: CaptionCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    const timingIndex = lines.findIndex((l) => l.includes('-->'));
    if (timingIndex < 0) continue;
    const [rawStart, rawRest] = lines[timingIndex].split('-->');
    const rawEnd = (rawRest ?? '').trim().split(/\s+/u)[0] ?? '';
    const start = parseTimestamp(rawStart);
    const end = parseTimestamp(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const body = unescapeCueText(lines.slice(timingIndex + 1).join(' ')).trim();
    cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
