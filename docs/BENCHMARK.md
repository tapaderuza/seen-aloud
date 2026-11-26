# Benchmark

Real runs of the deployed app, scored against written references. Nothing here is mocked: every number comes from a run recorded in `scripts/benchmark/results/`.

## Setup

| | |
| --- | --- |
| Date | 2026-11-26 |
| Machine | Intel Core i7-8750H, NVIDIA GeForce GTX 1050 + Intel UHD 630, 16 GB RAM, Windows 11 Home |
| Browser | Chromium 156 (Claude desktop browser pane). `LanguageModel.availability()` returned `unavailable`: **no Gemini Nano on this machine** |
| App | https://seen-aloud.web.app, commits `70e9270` (before) and `ffc260a` (after), Firebase JS SDK 13.4.0 (`@firebase/ai` 3.1.0) |
| Cloud models | `gemini-3.5-flash-lite`, fallback `gemini-3.8-flash` (Remote Config), Gemini Developer API free tier |
| Mode | Cloud (the only mode this machine can run end to end). One run per clip per version |

## Clips (`public/benchmark/`, built by `scripts/benchmark/make-videos.ps1`)

| # | Clip | Source |
| --- | --- | --- |
| 01 | Educational presentation with charts and numbers, 45 s | the bundled sample, author’s own explainer |
| 02 | Software tutorial (screen recording of this app), 40 s | author’s own recording |
| 03 | Conversation with pauses: two synthesized Spanish voices, three cards, 25 s | synthetic (Windows speech synthesizer, ffmpeg) |
| 04 | Motion: a red square moves right, a blue square rises, then THE END, 16 s, silent | synthetic (ffmpeg) |
| 05 | Continuous narration over terminal screens with burned-in captions, 45 s | author’s own explainer |
| 06 | Fictional sensitive record (name, date of birth, account number), 8 s, silent | synthetic, all data invented |

## Method

1. `scripts/benchmark/runner.js` is pasted into the DevTools console on the live site. It opens a clip, presses **Describe this video**, waits for the track and records: wall time, every Firebase AI Logic request (status, latency, request and response bytes), the ledger the app shows, and each finished line (start, extended or not, words and budget, text).
2. `scripts/benchmark/references.json` lists, per clip, the visual facts a good track should mention (written from the frames and, for synthetic clips, from the script that drew them), the numbers that really appear on screen (synthetic clips only) and, for clip 03, the speech timeline measured independently with `ffmpeg silencedetect` (-45 dB, 0.3 s).
3. `node scripts/benchmark/score.mjs <results-dir>` computes coverage (facts mentioned / facts), numbers not on screen, lines over their word budget, and non-extended lines that would overlap measured speech. It writes `summary.json`.

## Results (Cloud mode)

| Clip | Time (s) before → after | Requests | Frames sent | KB sent | Over budget | Coverage before → after |
| --- | --- | --- | --- | --- | --- | --- |
| 01 Presentation | 27.2 → 23.4 | 6 → 6 | 5 | 238 | 0 | 7/8 → 7/8 |
| 02 Software tutorial | 17.7 → 19.3 | 5 → 7 | 4 | 257 → 259 | 0 | 4/5 → 4/5 |
| 03 Conversation | 10.1 → 28.3 | 4 → 8 | 3 | 35 → 40 | 0 | 4/7 → 6/7 |
| 04 Motion | invalid → 14.3 | n/a → 5 | 3 | 26 | 0 | invalid → 3/6 |
| 05 Continuous narration | 19.4 → 21.6 | 5 → 6 | 4 | 76 → 79 | 0 | 4/5 → 5/5 |
| 06 Fictional record | 5.8 → 6.2 | 3 → 2 | 1 | 36 → 35 | 0 | 1/4 → 4/4 |

On the five clips valid in both rounds, coverage went from **20/29 to 26/29**. In both rounds: no line over its pause, no overlap with the measured speech in clip 03, no number that is not on screen in the synthetic clips.

What the runs showed, and what changed because of them:

- **Empty or text-only lines.** Before, the script writer sometimes returned an empty line for a scene that had changed, or only `On screen: ANA`. Since `ffc260a` such lines fall back to the scene’s own frame note (`engine.writeTrack`), which is why clips 03 and 06 improved.
- **Motion is not described.** The first clip 04 rendered blank screens (an ffmpeg `drawbox` time expression was ignored), so its first run is kept under `baseline-70e9270/invalid/` and not scored. With the fixed clip the track names both squares but not their movement: one key frame per scene cannot show motion.
- **Busy cloud answers happen.** Two requests in the second round got HTTP 429; the app retried them and the ledger shows `cloud busy (fetch-error), sent again to the same model`. That is why clip 03 took longer and used more requests.
- **Very short pauses give thin lines.** Clip 02 has 3-word pauses ("App highlights section"). The local review cannot catch vague text, only empty, over-long, text-only, number and repeat problems.
- **Cloud mode sends what is on screen.** In clip 06 the frame with the invented name and date of birth was uploaded (1 frame, about 35 KB) and the line reads it out. This is the case Private mode exists for.

Each figure is one run; the models are not deterministic, so expect differences between runs.

Cost: these runs used the Gemini Developer API free tier, so nothing was billed. Token counts were not recorded (the on-device path has no `countTokens`), so no dollar estimate is given; requests and bytes are reported instead.

## NOT TESTED here, and how to run it

| What | Why not | How to run it |
| --- | --- | --- |
| Private mode (all on Gemini Nano) | no Gemini Nano on this machine | Chrome 139+ with Gemini Nano 4 (see [JUDGE_QUICKSTART.md](JUDGE_QUICKSTART.md)), open the site, paste `runner.js`, run `await seenAloudBenchmark({ videoUrl: '/benchmark/06-sensitive-fictional.mp4', mode: 'private' })` for each clip, save each result as JSON in a new folder under `scripts/benchmark/results/`, then `node scripts/benchmark/score.mjs <folder>`. Expect `framesThatLeft: 0` and `requestsInCloud: 0`. |
| Hybrid with Gemini Nano | same | Same, with `mode: 'hybrid'`: frames on the device, one text-only script request in the cloud. |
| Hybrid without Gemini Nano | equivalent to Cloud for frames after consent | `mode: 'hybrid', acceptCloud: true` in a visible tab (the consent dialog needs a rendered page). |
| Offline behaviour | the test browser has no offline switch | Open the site, load a clip, then turn the network off in DevTools and describe it in Private mode with Gemini Nano. The cloud steps fail with a plain message; on-device steps need no network. |
