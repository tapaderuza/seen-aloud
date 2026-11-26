// Totals per mode and latency ranges for a folder of results written by to-results.mjs,
// plus a check that the app's ledger matches the network capture in every run.
//   node scripts/benchmark/cdp/stats.mjs scripts/benchmark/results/nano-a1bb738
// Cost uses the paid-tier price of gemini-3.5-flash-lite (USD 0.30 per million input tokens,
// 2.50 per million output tokens, ai.google.dev/gemini-api/docs/pricing, read 2026-11-26).
// The runs themselves used the free tier, so nothing was billed.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const PRICE_IN = 0.3 / 1e6;
const PRICE_OUT = 2.5 / 1e6;
const warm = [];
const cold = [];
const fit = [];
const cloudFrame = [];
const cloudScript = [];
const perMode = {};
const mismatches = [];

for (const f of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'summary.json')) {
  const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const m = (perMode[r.mode] ??= { runs: 0, seconds: 0, onDevice: 0, inCloud: 0, framesLeft: 0, kbToAi: 0, tokensIn: 0, tokensOut: 0, retries: 0 });
  const retries = r.ledger.log.filter((l) => /cloud busy/.test(l)).length;
  m.runs++;
  m.seconds += r.totalMs / 1000;
  m.onDevice += r.ledger.requestsOnDevice;
  m.inCloud += r.ledger.requestsInCloud;
  m.framesLeft += r.ledger.framesThatLeft;
  // A request that failed at the network layer (offline) never reached the cloud.
  const delivered = r.cdpNetwork.aiCalls.filter((c) => c.status);
  m.kbToAi += delivered.reduce((s, c) => s + c.bytesSent, 0) / 1024;
  m.undelivered = (m.undelivered ?? 0) + r.cdpNetwork.aiCalls.length - delivered.length;
  m.tokensIn += r.cdpNetwork.aiTokens.prompt;
  m.tokensOut += r.cdpNetwork.aiTokens.output;
  m.retries += retries;
  // Independent check: cloud inferences (plus retries) equal the POSTs the network capture saw delivered,
  // and frames the ledger counts as sent equal the requests that carried an image.
  if (r.ledger.requestsInCloud + retries !== delivered.length || r.ledger.framesThatLeft !== delivered.filter((c) => c.carriesImage).length) mismatches.push(f);
  for (const x of r.onDevice.ms) {
    if (x.task === 'Frame') (x.ms > 60000 ? cold : warm).push(x.ms);
    if (x.task === 'Fit') fit.push(x.ms);
  }
  for (const line of r.ledger.log) {
    let hit = line.match(/^Frame · Cloud · (\d+) ms/);
    if (hit) cloudFrame.push(Number(hit[1]));
    hit = line.match(/^Script · Cloud · (\d+) ms/);
    if (hit) cloudScript.push(Number(hit[1]));
  }
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const range = (a) => (a.length ? `${Math.min(...a)}–${Math.max(...a)} ms, median ${median(a)} ms, n=${a.length}` : 'none');
console.log('Gemini Nano, frame (model already loaded):', range(warm));
console.log('Gemini Nano, first frame after a page load (model loading):', range(cold));
console.log('Gemini Nano, fit a line:', range(fit));
console.log('Cloud, frame:', range(cloudFrame));
console.log('Cloud, script:', range(cloudScript));
for (const [mode, m] of Object.entries(perMode)) {
  const usd = m.tokensIn * PRICE_IN + m.tokensOut * PRICE_OUT;
  console.log(
    `${mode}: ${m.runs} runs, ${m.seconds.toFixed(1)} s, ${m.onDevice} on device, ${m.inCloud} in cloud, ${m.framesLeft} frames sent, ${m.kbToAi.toFixed(1)} KB to the AI endpoint, tokens ${m.tokensIn} in / ${m.tokensOut} out, USD ${usd.toFixed(4)} (${(usd / m.runs).toFixed(5)} per video), ${m.retries} retries${m.undelivered ? `, ${m.undelivered} AI request(s) that never left (network down)` : ''}`,
  );
}
console.log(mismatches.length ? `Ledger and network capture differ in: ${mismatches.join(', ')}` : 'Ledger and network capture agree in every run.');
