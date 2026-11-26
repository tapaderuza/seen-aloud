# Gemini Nano validation

Real runs of the live site (https://seen-aloud.web.app) with Gemini Nano in Google Chrome, on 2026-11-26. The network was recorded from outside the page, with the Chrome DevTools Protocol (CDP). Nothing here is mocked: every number comes from a result file under `scripts/benchmark/results/`.

**Result.** Gemini Nano works through Firebase AI Logic on this machine:

- **Private mode:** every inference ran on the device, with 0 requests to the AI endpoint.
- **Hybrid mode:** every frame was described on the device, and Gemini in the cloud wrote the script from text only (1 request per video, no image).
- **Ledger:** in all 30 recorded runs, the app's ledger matches the network capture.
- **Which model:** the 18-run benchmark used Chrome's default model (`nano_v3`). **Gemini Nano 4**, which the contest names for Web (`chrome://flags` "Gemma 4 for Built-in AI", model `gemma4_gpu_low_tier_model`), was validated in 5 recorded runs (section 8): 3 online and 2 offline. It was also used to record the demo video.

Two defects showed up only with a real model. Both are fixed in `223c141` and deployed:

- a Gemini Nano request that never answered;
- a model download that Chrome never started.

## 1. Why Gemini Nano was "not available" before

| Check | Finding |
| --- | --- |
| Browser used by the earlier audits | The Claude desktop browser pane (embedded Chromium 156). It is not Google Chrome; built-in AI ships with Google Chrome, and there `LanguageModel.availability()` said `unavailable`. **The earlier "no Gemini Nano on this machine" was a statement about that browser, not about the machine.** |
| Google Chrome | 158.0.8127.88 (stable), `C:\Program Files\Google\Chrome` |
| Operating system | Windows 11 Home 10.0.26200, 64-bit (Chrome needs Windows 10 or 11) |
| CPU, RAM | Intel Core i7-8750H, 6 cores / 12 threads; 16 GB installed (15.9 GB usable) |
| GPU | NVIDIA GeForce GTX 1050, 4 GB (Chrome reads 4004 MiB), plus Intel UHD 630 |
| Storage | **C: 8.2 GB free** (the owner's Chrome profile lives there), D: 644 GB free |
| Model download | Never done in the owner's profile (no `OptGuideOnDeviceModel` folder) |
| Flags | None set in the owner's profile; none needed (below) |
| `LanguageModel` | Present in Google Chrome 158 on `https://seen-aloud.web.app` (secure context, top-level page, no iframe, no worker) |
| `availability()` | Text, and text + image, in English and in Spanish: `downloadable` in a fresh profile, `available` after the download. Audio input: `unavailable` |
| Image input | Works with no flag on Chrome 158 (`prompt-api-multimodal-input` left at Default) |
| Languages | `en` and `es`, the two the app offers (Chrome documents `en`, `ja`, `es`, `de`, `fr`) |
| Firebase AI Logic | Firebase JS SDK 13.4.0 (`@firebase/ai` 3.1.0). Its source was read; see section 3 |

**Exact cause.** The owner's Chrome profile is on C:, which has 8.2 GB free. Chrome's own page says so, in a fresh profile on C: (`chrome://on-device-internals`, Broker State):

> Enough disk space to install: **false** (8380 MiB available, 20480 MiB required)

Google's requirements ([get started](https://developer.chrome.com/docs/ai/get-started)) ask for at least 22 GB free on the volume that holds the Chrome profile. The rest of the hardware passes Chrome's checks: performance class Medium, "Device capable: true", and "Enough VRAM: true (4004 MiB actual, 3000 MiB required)". Chrome 158 picked its low-tier GPU model for this card. The documentation says "strictly more than 4 GB of VRAM", but Chrome itself accepted 4004 MiB.

The disk problem is invisible through the API. With too little space:

- `availability()` still says `downloadable`;
- after the click it says `downloading`;
- no progress ever arrives, and `create()` never settles.

Before `223c141` the app then waited in silence.

**Where the problem lives:** the environment (disk space) and the test browser. The SDK and our routing were not at fault. The app did have one gap: it never said the download had not started. That is fixed (section 6).

## 2. How Gemini Nano was enabled

1. Google Chrome was started with a profile on D:, and no flags:

   ```
   chrome.exe --user-data-dir=D:\chrome-nano-profile --remote-debugging-port=9333
   ```

   The debugging port is only for the measurements.
2. On the live site, **Download Gemini Nano** was pressed with a real mouse click (Chrome only starts the download on a user gesture). The status went "Downloading Gemini Nano… 5%" up to 90%, and `availability()` turned `available` after about 8 minutes.
3. `chrome://on-device-internals` then showed `nano_v3_gpu_component 2025.8.8.1141 Ready 100%` and model `nano_v3_gpu_low_tier_model`, 4,088 MiB, on the GPU backend. `prompt_api` was `Available`. Screenshot: [nano/01-chrome-model-installed.png](nano/01-chrome-model-installed.png).

**For the owner's everyday Chrome:** free at least 14 GB on C: (to reach 22 GB free), or use a Chrome profile on D: as above. `chrome://on-device-internals` (turn on debugging pages in `chrome://chrome-urls` first) shows whether the criteria pass.

## 3. Integration audit (Firebase AI Logic, SDK source read)

| API | What the SDK does (13.4.0) | What Seen Aloud does | Verdict |
| --- | --- | --- | --- |
| `PREFER_ON_DEVICE` | Device only if `availability(createOptions)` is exactly `available` and every image is JPEG or PNG; otherwise cloud | Frames in Hybrid after consent, and every fit. Frames are JPEG | Correct |
| `ONLY_ON_DEVICE` | Throws if `unavailable`; **if `LanguageModel` does not exist, no on-device adapter is created and the call goes to the cloud**; if `downloadable`, it calls `create()`, which needs a user gesture | Private mode, and Hybrid frames before consent. The app checks `availability === 'available'` first and refuses otherwise (`PrivacyGuardError`), so neither SDK edge is reached | Correct; verified without Nano (section 4) |
| `PREFER_IN_CLOUD` | Cloud first; falls back to the device on `FETCH_ERROR`, `ERROR` or `API_NOT_ENABLED` when Nano is `available` | Hybrid script (text only) | Correct; offline fallback in section 8 |
| `ONLY_IN_CLOUD` | Cloud only | Cloud mode, and the retry of a failed on-device request after consent | Correct |
| `initializeDeviceModel(onProgress)` | Calls `create()` with a monitor and **awaits the download**; progress is `e.loaded` from 0 to 1 | Called from the button's click handler | Correct; a silent wait when Chrome never starts is now reported |
| `inferenceSource` | `on_device` or `in_cloud` on every response | Feeds the ledger | Matches the network capture in every run |
| `expectedInputs` / `expectedOutputs` | Passed to `availability()` and `create()` | `[{type:'text',languages:['en']},{type:'image'}]` for frames, text only for the rest; output in the chosen language | Correct (`en` prompts, `en`/`es` output) |
| `responseConstraint` | Passed to `session.prompt()` | The same JSON Schema as the cloud's `responseJsonSchema` | Nano returned parseable JSON in every finished run |
| Image parts | `inlineData` base64 → Blob → `ImageBitmap` → `{type:'image'}` | One JPEG key frame per scene | Correct |
| Sessions | A new session per request; the previous one is destroyed when the next is created | Requests to Nano are made one after another, never in parallel | Correct; parallel calls would cut each other off |
| Abort | No signal reaches the on-device prompt | The app stops waiting after 3 minutes (section 6) | Mitigated |

## 4. The three modes on production

Reference video: the built-in 45-second explainer (clip 01), and the fictional sensitive record (clip 06). Build `223c141` (bundle `index-Cat493On.js`), Chrome 158 with Gemini Nano.

| Run | Time | On device | Cloud requests | Frames sent | Bytes to the AI endpoint | Ledger note |
| --- | --- | --- | --- | --- | --- | --- |
| Private, clip 06 | 19.2 s | 2 (frame 11.8 s, fit 6.2 s) | 0 | 0 | 0 | "1 frame described on this computer. No pixels have left it." |
| Hybrid, clip 01 | 98.3 s | 6 (5 frames, 11.8–21.1 s; 1 fit) | 1 (script, text, 5.7 s) | 0 | 7.0 KB | "5 frames described on this computer. No pixels have left it." |
| Cloud, clip 01 | 36.9 s | 0 | 6 | 5 | 237.7 KB | "5 frames were described in the cloud." |
| Private, clip 03, Spanish | 24.1 s | 6 | 0 | 0 | 0 | Lines in Spanish ("ANA aparece en azul brillante."), read aloud by a Windows voice (Microsoft Helena) |

Without a usable Gemini Nano: the same Chrome, with a profile on C: where Chrome refused the download.

| Run | What happened | AI requests (CDP) |
| --- | --- | --- |
| Private, clip 06 | Refused: "Private mode needs Gemini Nano, which is downloading on this device. Nothing was sent to the cloud." | 0 |
| Hybrid, clip 06, consent declined | The consent dialog opened; after "Keep frames here": "You chose to keep frames on this device…" | 0 |
| Hybrid, clip 06, consent given | 1 frame and 2 text requests in the cloud; the ledger shows "Frames that left this computer: 1" | 3 (1 with an image) |

Playback and export worked in every finished run:

- **WebVTT:** the download held one cue per line.
- **Hybrid and Cloud:** the voice spoke the lines.
- **Extended lines:** they paused the video until they were spoken.
- **Private:** only voices installed on the computer may speak. This Windows has local voices for Spanish only, so English Private runs showed the text instead, which is the intended behaviour, and the Spanish run spoke.

Screenshots:

- [Hybrid ledger, 0 frames](nano/02-hybrid-ledger-zero-frames.png)
- [Private, fictional record](nano/03-private-fictional-record.png)
- [Cloud](nano/04-cloud-comparison.png)
- [Private in Spanish](nano/05-private-spanish-local-voice.png)
- [Private refuses without Nano](nano/06-private-refuses-without-nano.png)
- [Hybrid consent declined](nano/07-hybrid-consent-declined.png)
- [Download never starts](nano/08-download-never-starts.png)

## 5. Network verification

**Method.** `scripts/benchmark/cdp/run.mjs` drives Chrome over CDP:

1. It enables the `Network` domain, loads the site in the chosen mode and runs `scripts/benchmark/runner.js` (the same runner as the Cloud benchmark).
2. It records every request outside the page. For each one it keeps the host and path (no query string), the method, status, timing and sizes, whether the body carried an image, and whether it carried any of the four strings of the fictional record (`Jane Example`, `01/02/1980`, `0000-1111`, `FICTIONAL TEST RECORD`).
3. For AI requests it also keeps `usageMetadata` and a 160-character preview of the prompt text.

Headers (App Check tokens, API keys), cookies and image bytes are never stored.

**Infrastructure traffic, carrying no user content:**

- **Every mode:** the site's own files and reCAPTCHA Enterprise for App Check (`www.google.com/recaptcha/...`, `www.gstatic.com/recaptcha/...`, `content-firebaseappcheck.googleapis.com`).
- **Hybrid and Cloud:** Firebase Auth (`identitytoolkit`) and Firestore (`Listen/channel`), used to list saved tracks. Private mode made no Auth or Firestore request.
- **Remote Config:** cached by the SDK for an hour, so it did not appear in these runs.

**Inference traffic.** Only `firebasevertexai.googleapis.com/.../models/gemini-3.5-flash-lite:generateContent`. CORS preflights (`OPTIONS`, no body) are left out of the counts.

**The fictional record (clip 06):**

| Mode | Requests carrying an image | Requests carrying the record's text | What left |
| --- | --- | --- | --- |
| Private | 0 | 0 | Nothing |
| Hybrid (Nano ready) | 0 | 1 (the script request) | **Text only, including the name, date of birth and account number that Gemini Nano read off the screen**: the frame note's on-screen text is part of the script input |
| Cloud | 1 | 2 (the script and the fit request) | The frame, and the text |

Hybrid keeps pixels on the device. It does not keep what is written in them: on-screen text goes to the cloud as text. The mode description in the app says so ("the scene notes, any on-screen text and any caption text… go to Gemini in the cloud as text"). Masking it is listed under next steps; for footage like this, use Private.

**Ledger against the capture.** In each of the 30 recorded runs (folders `nano-a1bb738`, `nano-223c141`, `no-nano-223c141`, `gemma4-223c141` and `offline-223c141`):

- the ledger's cloud requests, plus retries, equal the POSTs seen by CDP;
- the ledger's "frames that left" equal the requests that carried an image.

`node scripts/benchmark/cdp/stats.mjs <folder>` checks this.

## 6. Defects found by these runs, fixed in `223c141`

1. **A Gemini Nano request that never answers.** In one Hybrid run of clip 01, the fourth frame prompt never settled. There was no error, no network request and no console message, and the job waited for 30 minutes (`scripts/benchmark/results/nano-a1bb738/hang/`). A rerun right after finished normally. Requests that may run on Gemini Nano now stop after 3 minutes (`DeviceTimeoutError`):
   - **Hybrid:** asks before retrying that frame in the cloud, as for any Nano failure.
   - **Private:** leaves that line empty, with no cloud request.
   - **A rewrite:** falls back to trimming.

   The SDK gives no way to abort the on-device prompt itself; the next request's new session replaces it. 5 regression tests.
2. **A download Chrome never starts** (too little disk). The status now changes at once to "starting the download". If no progress arrives within 30 seconds, it says "Chrome has not started the download" and explains the 22 GB requirement and where Chrome shows its reason. Verified in production with the profile on C: ([screenshot](nano/08-download-never-starts.png)). 4 regression tests.
3. **Outdated instructions.** The app, README and quickstart told people to set `chrome://flags` entries and use Chrome 139+. The Prompt API is on by default in Chrome 148+ ([Chrome docs](https://developer.chrome.com/docs/ai/prompt-api)), and image input needed no flag on Chrome 158.

Tests: 132 passing (123 before, 9 new), typecheck clean, production build clean.

## 7. Benchmark: Private, Hybrid and Cloud on the six clips

See [BENCHMARK.md](BENCHMARK.md#gemini-nano-private-hybrid-and-cloud-2026-11-26). The results are in `scripts/benchmark/results/nano-a1bb738/`: 18 runs, bundle `index-Cvkl-krS.js`, whose JavaScript is the same as `a1bb738`'s.

## 8. Offline and Gemma 4

**Offline** (`scripts/benchmark/results/offline-223c141/`). Clip 04 was fetched first; then DevTools network emulation cut every request, and the clip was described with the network off.

| Mode | Result | Network during the run |
| --- | --- | --- |
| Private | Done: 3 frames and 1 fit on Gemini Nano, 36.5 s | No request |
| Hybrid | Done: 3 frames on Gemini Nano. The cloud script request failed with `net::ERR_INTERNET_DISCONNECTED`, and the SDK's `PREFER_IN_CLOUD` fallback sent it to Gemini Nano ("Script · On device · 14.2 s"). 46.2 s | 1 AI request attempted, never delivered; 1 Firestore request failed |

So the hybrid design works with no connection, once the page and the model are on the computer. The ledger shows where each answer came from. It does not list the SDK's internal cloud attempt, which never reached the network. There is no service worker, so the page itself still needs the network to load.

**Gemma 4 for Built-in AI** (`scripts/benchmark/results/gemma4-223c141/`). The contest FAQ names the `chrome://flags` entry **Gemma 4 for Built-in AI** (Gemini Nano 4); on Chrome 158 it is `gemma4-for-built-in-ai`. With it set to Enabled in the same profile:

- `availability()` went back to `downloadable` until Chrome had downloaded `gemma4_component` 2026.11.3.1140: model `gemma4_gpu_low_tier_model`, 2,361 MiB, GPU backend, about 17 minutes.
- After the runs, `chrome://on-device-internals` listed the use case `prompt_api_gemma4` as Available. Before, it said "Pending Usage".

| Run | Time | On device | Cloud requests | Frames sent | Coverage |
| --- | --- | --- | --- | --- | --- |
| Private, clip 06 | 27.8 s | 2 | 0 | 0 | 1/4 |
| Hybrid, clip 01 | 100.4 s | 6 | 1 (script, text) | 0 | 6/8 |
| Private, clip 01 | 107.3 s | 10 | 0 | 0 | 6/8 |

Frames took 14.2 to 21.9 s with Gemma 4 on this GPU (median 16.3 s). On the fictional record, Gemma 4 described the card ("Red title and three black lines show fictional test record details") without reading out the name. That is better for privacy and worse for coverage. The offline runs above used this configuration too, with both models installed. Seen Aloud needed no change for Gemma 4.

## 9. Reproduce

1. Use desktop Google Chrome 148+ with at least 22 GB free on the drive of the profile you use. Start it with a profile of its own and a debugging port, for example:

   ```
   chrome.exe --user-data-dir=D:\chrome-nano-profile --remote-debugging-port=9333 --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows
   ```

   The last two switches keep a covered window rendering. In a hidden tab the page gets no clicks, so Chrome sees no user gesture.
2. Open https://seen-aloud.web.app in that window and press **Download Gemini Nano**. Wait for "Gemini Nano: ready on this device".
3. Run, with Git Bash users setting `MSYS_NO_PATHCONV=1`:

   ```
   node scripts/benchmark/cdp/run.mjs private /benchmark/06-sensitive-fictional.mp4 no runs --play
   node scripts/benchmark/cdp/run.mjs hybrid /samples/sample-explainer-45s.mp4 no runs --play
   node scripts/benchmark/cdp/run.mjs cloud /samples/sample-explainer-45s.mp4 yes runs --play
   ```
4. Convert and check:

   ```
   node scripts/benchmark/cdp/to-results.mjs runs scripts/benchmark/results/my-run <commit>
   node scripts/benchmark/score.mjs scripts/benchmark/results/my-run
   node scripts/benchmark/cdp/stats.mjs scripts/benchmark/results/my-run
   ```

Without a terminal, the same runner works from the DevTools console ([BENCHMARK.md](BENCHMARK.md)); open the Network panel to watch the requests.

## 10. Limits and what was not tested

- **One machine:** a 4 GB GTX 1050 on Windows 11. No CPU-only machine, no macOS, Linux or ChromeOS, no other GPU. On-device speed will differ.
- **One run per clip and mode.** The models are not deterministic, so expect differences between runs. For example, clip 06 in Cloud covered 4/4 facts in the earlier Cloud round (`after-ffc260a`) and 1/4 in this one.
- **The timeout cannot be triggered on demand:** the hang happened once in 17 runs that used Gemini Nano. The behaviour after a timeout is covered by unit tests, not by a real hang.
- **Voices:** in Hybrid and Cloud the browser may use Google's network voices. Chrome sends that text itself, outside the page, so the CDP page capture does not see it. Private mode only uses voices installed on the computer.
- **Free tier:** the runs used the Gemini Developer API free tier, so nothing was billed. Google's pricing page says free-tier content is used to improve its products. That covers Hybrid's text and Cloud's frames; a paid tier changes it.
- **Tested in Chrome only.** No other browser was tested, and there are no sessions with blind or low-vision viewers yet.
