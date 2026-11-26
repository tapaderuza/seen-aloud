// One real run of the live app in the test Chrome, with an independent network record
// taken by the Chrome DevTools Protocol (not by the page).
//   node run.mjs <mode> <videoPath> <acceptCloud yes|no> <outDir> [--play]
// Needs Google Chrome started with --remote-debugging-port=9333 (CDP_PORT) and a --user-data-dir of its own.
// Env: SITE (default production), DESC_LANG (en|es), OFFLINE=1 (network off after the clip is fetched).
// In Git Bash, set MSYS_NO_PATHCONV=1 so /benchmark/... is not rewritten into a Windows path.
// Writes <outDir>/<mode>-<clip>.json (runner output + CDP network summary) and a full-page PNG.
// Stored: host + path (no query string), method, sizes, timings, whether a body carried an
// image, which fictional test strings it carried, and a short preview of AI prompt text.
// Not stored: headers (App Check tokens, API keys), cookies, image bytes.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, pageTarget, sleep } from './cdp.mjs';

const [mode, video, accept = 'yes', outDir = 'runs', ...flags] = process.argv.slice(2);
const play = flags.includes('--play');
const SITE = process.env.SITE || 'https://seen-aloud.web.app/';
const RUNNER = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'runner.js'), 'utf8');
const SENSITIVE = ['Jane Example', '0000-1111', '01/02/1980', 'FICTIONAL TEST RECORD'];
mkdirSync(outDir, { recursive: true });
const clip = basename(video, '.mp4') + (process.env.OFFLINE ? '-offline' : '') + (process.env.DESC_LANG && process.env.DESC_LANG !== 'en' ? '-' + process.env.DESC_LANG : '');

function category(url) {
  const host = new URL(url).host;
  if (/firebasevertexai\.googleapis\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/.test(host)) return 'ai-inference';
  if (/firebaseappcheck|recaptcha/.test(host) || /\/recaptcha\//.test(url)) return 'app-check';
  if (/firebaseremoteconfig|firebaseinstallations/.test(host)) return 'remote-config';
  if (/identitytoolkit|securetoken/.test(host)) return 'auth';
  if (/firestore\.googleapis\.com/.test(host)) return 'firestore';
  if (host === new URL(SITE).host) return 'site-static';
  return 'other:' + host;
}

const t = await pageTarget(new URL(SITE).host);
const c = await connect(t.webSocketDebuggerUrl);
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Network.enable', { maxPostDataSize: 20_000_000 });
await c.send('Page.bringToFront');

const reqs = new Map();
let phase = 'load';
const consoleErrors = [];
c.on('Network.requestWillBeSent', (p) => {
  if (!/^https?:/.test(p.request.url)) return;
  reqs.set(p.requestId + (reqs.has(p.requestId) ? ':redirect' : ''), {
    id: p.requestId,
    url: p.request.url,
    method: p.request.method,
    postData: p.request.postData ?? null,
    hasPostData: !!p.request.hasPostData,
    start: p.timestamp,
    phase,
  });
});
c.on('Network.responseReceived', (p) => {
  const r = reqs.get(p.requestId);
  if (r) r.status = p.response.status;
});
c.on('Network.loadingFinished', (p) => {
  const r = reqs.get(p.requestId);
  if (r) Object.assign(r, { end: p.timestamp, received: p.encodedDataLength });
});
c.on('Network.loadingFailed', (p) => {
  const r = reqs.get(p.requestId);
  if (r) Object.assign(r, { end: p.timestamp, failed: p.errorText });
});
c.on('Runtime.consoleAPICalled', (p) => {
  if (p.type === 'error' || p.type === 'warning') consoleErrors.push(`${p.type}: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
});
c.on('Runtime.exceptionThrown', (p) => consoleErrors.push(`exception: ${(p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 300)}`));

// Start in the requested mode from the first byte, so the load-time traffic is that mode's.
await c.evaluate(`localStorage.setItem('seen-aloud:mode', ${JSON.stringify(mode)})`).catch(() => {});
await c.evaluate(`localStorage.setItem('seen-aloud:language', ${JSON.stringify(process.env.DESC_LANG || 'en')})`).catch(() => {});
await c.send('Page.navigate', { url: SITE });
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  await sleep(500);
  const ready = await c
    .evaluate(`!!document.getElementById('analyze') && !document.getElementById('analyze').disabled && !/Checking/.test(document.getElementById('device-status').textContent)`)
    .catch(() => false);
  if (ready) break;
}
await sleep(1500);
const device = await c.evaluate(`(async () => ({
  status: document.getElementById('device-status').textContent,
  availabilityImage: typeof LanguageModel === 'undefined' ? 'no LanguageModel' : await LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }),
  mode: document.querySelector('input[name="mode"]:checked')?.value,
}))()`);

await c.evaluate(RUNNER);
if (process.env.OFFLINE) {
  // Offline test: the clip is fetched now, then every network request fails (DevTools offline emulation).
  await c.evaluate(`(async () => { const b = await (await fetch(${JSON.stringify(video)})).blob(); const orig = window.fetch; window.fetch = (input, init) => ((typeof input === 'string' ? input : input.url) === ${JSON.stringify(video)} ? Promise.resolve(new Response(b, { headers: { 'content-type': 'video/mp4' } })) : orig(input, init)); return b.size; })()`);
  await c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
}
phase = 'run';
const started = Date.now();
let runner;
let runError = null;
try {
  runner = await c.evaluate(
    `seenAloudBenchmark({ videoUrl: ${JSON.stringify(video)}, mode: ${JSON.stringify(mode)}, acceptCloud: ${accept === 'yes'}, timeoutMs: 1800000 })`,
    { timeout: 1900000 },
  );
} catch (error) {
  runError = String(error.message || error);
  runner = await c
    .evaluate(`({ message: document.getElementById('progress-text').textContent, ledgerNote: document.getElementById('ledger-note').textContent, framesThatLeft: document.getElementById('m-frames').textContent, log: [...document.getElementById('log').querySelectorAll('li')].map((li) => li.textContent).reverse() })`)
    .catch(() => null);
}
const wallMs = Date.now() - started;
if (process.env.OFFLINE) await c.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await sleep(2000);

// Playback and export checks on the finished track.
let playback = null;
let vtt = null;
if (play && !runError) {
  phase = 'playback';
  const dl = join(process.cwd(), outDir, `dl-${mode}-${clip}`);
  mkdirSync(dl, { recursive: true });
  await c.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }).catch(() => {});
  await c.evaluate(`document.getElementById('download-vtt').click()`, { userGesture: true });
  await sleep(2000);
  const f = readdirSync(dl).find((n) => n.endsWith('.vtt'));
  vtt = f ? readFileSync(join(dl, f), 'utf8') : null;
  await c.evaluate(`(() => { const v = document.querySelector('video'); v.currentTime = 0; return v.play().then(() => true, (e) => String(e)); })()`, { userGesture: true });
  const samples = [];
  for (let i = 0; i < 14; i++) {
    await sleep(1000);
    samples.push(
      await c.evaluate(`({ t: +document.querySelector('video').currentTime.toFixed(2), paused: document.querySelector('video').paused, speaking: speechSynthesis.speaking, overlay: (document.getElementById('overlay')?.textContent || '').slice(0, 120) })`),
    );
  }
  await c.evaluate(`document.querySelector('video').pause()`);
  playback = { samples, voices: await c.evaluate(`speechSynthesis.getVoices().map((v) => v.name + (v.localService ? ' (local)' : ' (network)'))`) };
}

// Full-page screenshot of the finished state.
const metrics = await c.send('Page.getLayoutMetrics');
const size = metrics.cssContentSize || metrics.contentSize;
const shot = await c.send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.min(Math.ceil(size.height), 6000), scale: 1 },
});
writeFileSync(join(outDir, `${mode}-${clip}.png`), Buffer.from(shot.data, 'base64'));

// Fill in bodies the event did not carry, and read token usage from AI responses.
const rows = [];
for (const r of reqs.values()) {
  if (r.postData === null && r.hasPostData) {
    try {
      r.postData = (await c.send('Network.getRequestPostData', { requestId: r.id })).postData;
    } catch {
      r.postData = '';
    }
  }
  const body = r.postData || '';
  const cat = category(r.url);
  const u = new URL(r.url);
  let usage = null;
  let promptPreview = null;
  let model = null;
  if (cat === 'ai-inference') {
    model = (u.pathname.match(/models\/([^:]+)/) || [])[1] || null;
    try {
      const resp = await c.send('Network.getResponseBody', { requestId: r.id });
      const text = resp.base64Encoded ? Buffer.from(resp.body, 'base64').toString('utf8') : resp.body;
      usage = JSON.parse(text).usageMetadata ?? null;
    } catch {
      usage = null;
    }
    try {
      const parsed = JSON.parse(body);
      const parts = (parsed.contents || []).flatMap((x) => x.parts || []);
      promptPreview = parts
        .map((p) => (p.text ? `text(${p.text.length} chars): ${p.text.slice(0, 160).replace(/\s+/g, ' ')}` : p.inlineData ? `image ${p.inlineData.mimeType} (${p.inlineData.data.length} base64 chars)` : Object.keys(p).join(',')))
        .join(' | ');
    } catch {
      promptPreview = null;
    }
  }
  rows.push({
    phase: r.phase,
    category: cat,
    method: r.method,
    url: `${u.host}${u.pathname}`,
    status: r.status ?? null,
    failed: r.failed ?? null,
    ms: r.end ? Math.round((r.end - r.start) * 1000) : null,
    bytesSent: Buffer.byteLength(body),
    bytesReceived: r.received ?? null,
    carriesImage: /"inlineData"|data:image\/|\/9j\/4AAQ/.test(body),
    sensitiveHits: SENSITIVE.filter((s) => body.includes(s) || r.url.includes(encodeURIComponent(s)) || r.url.includes(s)),
    model,
    usage,
    promptPreview,
  });
}
const byCategory = {};
for (const row of rows) {
  const k = `${row.phase}/${row.category}`;
  byCategory[k] ??= { requests: 0, bytesSent: 0, bytesReceived: 0, withImage: 0, withSensitive: 0 };
  const b = byCategory[k];
  b.requests++;
  b.bytesSent += row.bytesSent;
  b.bytesReceived += row.bytesReceived || 0;
  if (row.carriesImage) b.withImage++;
  if (row.sensitiveHits.length) b.withSensitive++;
}
// CORS preflights (OPTIONS) carry no body and are not inferences.
const ai = rows.filter((r) => r.category === 'ai-inference' && r.method !== 'OPTIONS');
const out = {
  mode,
  video,
  acceptCloud: accept === 'yes',
  date: new Date().toISOString(),
  wallMs,
  runError,
  deviceAtStart: device,
  runner,
  playback,
  vtt,
  network: {
    total: rows.length,
    byCategory,
    aiRequests: ai.length,
    aiWithImage: ai.filter((r) => r.carriesImage).length,
    aiTokens: ai.reduce(
      (s, r) => ({ prompt: s.prompt + (r.usage?.promptTokenCount || 0), output: s.output + (r.usage?.candidatesTokenCount || 0) + (r.usage?.thoughtsTokenCount || 0) }),
      { prompt: 0, output: 0 },
    ),
    anyRequestWithSensitive: rows.filter((r) => r.sensitiveHits.length).map((r) => `${r.phase} ${r.category} ${r.url} ${r.sensitiveHits.join(',')}`),
    rows,
  },
  consoleErrors,
  environment: {
    userAgent: await c.evaluate('navigator.userAgent'),
    bundle: await c.evaluate(`[...document.scripts].map((s) => s.src).find((s) => s.includes('/assets/index-')) || ''`),
  },
};
writeFileSync(join(outDir, `${mode}-${clip}.json`), JSON.stringify(out, null, 2) + '\n');
console.log(
  JSON.stringify(
    { mode, clip, wallMs, runError, device, message: runner?.message, ledger: runner?.ledger, consent: runner?.consentShown, byCategory, aiTokens: out.network.aiTokens, sensitive: out.network.anyRequestWithSensitive, consoleErrors: consoleErrors.slice(0, 5) },
    null,
    1,
  ),
);
c.close();
