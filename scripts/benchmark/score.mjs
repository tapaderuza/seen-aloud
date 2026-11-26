// Scores benchmark runs against the annotated references.
// Usage: node scripts/benchmark/score.mjs [results-dir]
// Reads every *.json run in results-dir (default scripts/benchmark/results), writes
// summary.json next to them and prints a Markdown table. Pure arithmetic over the
// recorded runs: no model is called here.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? join(here, 'results');
const references = JSON.parse(readFileSync(join(here, 'references.json'), 'utf8'));
const WORDS_PER_SECOND = 2.5 * 1.1; // the app's default pace times the default voice rate

function score(run) {
  const ref = references[run.video];
  const text = run.cues.map((c) => c.text).join(' \n ');
  const facts = Object.entries(ref.facts).map(([fact, pattern]) => ({ fact, found: new RegExp(pattern, 'iu').test(text) }));
  const numbers = [...text.matchAll(/\d+(?:[.,]\d+)?/gu)].map((m) => m[0].replace(',', '.'));
  const unsupportedNumbers = ref.allowedNumbers ? numbers.filter((n) => !ref.allowedNumbers.includes(n)) : null;
  const spoken = run.cues.filter((c) => c.text.trim());
  let overlaps = null;
  let interruptions = null;
  if (ref.speechWindows) {
    const inSpeech = (a, b) => ref.speechWindows.some(([s, e]) => a < e && b > s);
    overlaps = spoken.filter((c) => !c.extended && inSpeech(c.start, c.start + c.words / WORDS_PER_SECOND)).length;
    interruptions = spoken.filter((c) => c.extended && inSpeech(c.start, c.start + 0.01)).length;
  }
  const callMs = run.network.calls.map((c) => c.ms).filter((ms) => typeof ms === 'number');
  return {
    video: run.video,
    label: ref.label,
    mode: run.mode,
    totalSeconds: +(run.totalMs / 1000).toFixed(1),
    aiRequests: run.network.aiRequests,
    failedRequests: run.network.calls.filter((c) => c.error || (c.status && c.status >= 400)).length,
    meanRequestMs: callMs.length ? Math.round(callMs.reduce((a, b) => a + b, 0) / callMs.length) : null,
    framesThatLeft: run.ledger.framesThatLeft,
    requestsOnDevice: run.ledger.requestsOnDevice,
    kbSent: +(run.network.bytesSent / 1024).toFixed(1),
    kbReceived: +(run.network.bytesReceived / 1024).toFixed(1),
    lines: spoken.length,
    extendedLines: spoken.filter((c) => c.extended).length,
    overBudget: spoken.filter((c) => c.words > c.budget).length,
    coverage: `${facts.filter((f) => f.found).length}/${facts.length}`,
    missed: facts.filter((f) => !f.found).map((f) => f.fact),
    unsupportedNumbers,
    overlapsWithSpeech: overlaps,
    pausesThatInterruptSpeech: interruptions,
  };
}

const runs = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'summary.json')
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const rows = runs.map(score);
writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(rows, null, 2)}\n`);

const cell = (v) => (v === null || v === undefined ? 'n/a' : Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : String(v));
const columns = ['label', 'mode', 'totalSeconds', 'aiRequests', 'meanRequestMs', 'framesThatLeft', 'kbSent', 'lines', 'extendedLines', 'overBudget', 'coverage', 'unsupportedNumbers', 'overlapsWithSpeech'];
console.log(`| ${columns.join(' | ')} |`);
console.log(`| ${columns.map(() => '---').join(' | ')} |`);
for (const row of rows) console.log(`| ${columns.map((c) => cell(row[c])).join(' | ')} |`);
