// Copies CDP runs (run.mjs output) into a benchmark results folder in the format
// scripts/benchmark/score.mjs reads, keeping the independent CDP network summary.
//   node to-results.mjs <runsDir> <resultsDir> <commit>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [runsDir, resultsDir, commit] = process.argv.slice(2);
mkdirSync(resultsDir, { recursive: true });
for (const f of readdirSync(runsDir).filter((n) => n.endsWith('.json'))) {
  const run = JSON.parse(readFileSync(join(runsDir, f), 'utf8'));
  if (run.runError || !run.runner?.cues) {
    console.log('skipped (no finished track):', f, run.runError);
    continue;
  }
  const r = run.runner;
  const onDeviceMs = r.ledger.log
    .map((line) => line.match(/^(\w+) · On device · (\d+) ms/))
    .filter(Boolean)
    .map((m) => ({ task: m[1], ms: Number(m[2]) }));
  const out = {
    ...r,
    onDevice: { inferences: onDeviceMs.length, ms: onDeviceMs },
    cdpNetwork: {
      note: 'Recorded by the Chrome DevTools Protocol, outside the page. Host and path only; no headers, tokens or image bytes.',
      aiRequests: run.network.rows.filter((x) => x.category === 'ai-inference' && x.method !== 'OPTIONS').length,
      aiWithImage: run.network.rows.filter((x) => x.category === 'ai-inference' && x.method !== 'OPTIONS' && x.carriesImage).length,
      aiTokens: run.network.aiTokens,
      requestsWithFictionalRecordText: run.network.anyRequestWithSensitive,
      byCategory: run.network.byCategory,
      aiCalls: run.network.rows
        .filter((x) => x.category === 'ai-inference' && x.method !== 'OPTIONS')
        .map(({ phase, model, status, failed, ms, bytesSent, bytesReceived, carriesImage, usage, promptPreview }) => ({ phase, model, status, failed, ms, bytesSent, bytesReceived, carriesImage, usage, promptPreview })),
    },
    deviceAtStart: run.deviceAtStart,
    playback: run.playback,
    vtt: run.vtt,
    environment: { ...r.environment, commit, date: run.date, browser: process.env.BROWSER_NOTE || 'Google Chrome 158.0.8127.88 (separate profile on D:, driven over CDP)' },
  };
  writeFileSync(join(resultsDir, f), JSON.stringify(out, null, 2) + '\n');
  console.log('written', f);
}
