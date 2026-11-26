# Benchmark

Real runs of the deployed app, scored against written references. Nothing here is mocked: every number comes from a run recorded in `scripts/benchmark/results/`.

## Setup

| | |
| --- | --- |
| Date | 2026-11-26 |
| Machine | Intel Core i7-8750H, NVIDIA GeForce GTX 1050 + Intel UHD 630, 16 GB RAM, Windows 11 Home |
| Browser | First two rounds: Chromium 156 (Claude desktop browser pane), where `LanguageModel.availability()` returned `unavailable`. That browser has no built-in AI; the machine does (see the Gemini Nano round below and [GEMINI_NANO_VALIDATION.md](GEMINI_NANO_VALIDATION.md)) |
| App | https://seen-aloud.web.app, commits `70e9270` (before) and `ffc260a` (after), Firebase JS SDK 13.4.0 (`@firebase/ai` 3.1.0) |
| Cloud models | `gemini-3.5-flash-lite`, fallback `gemini-3.8-flash` (Remote Config), Gemini Developer API free tier |
| Mode | First two rounds: Cloud. Third round: Private, Hybrid and Cloud with Gemini Nano (below). One run per clip per version |

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

Cost: these runs used the Gemini Developer API free tier, so nothing was billed. Token counts were not recorded in these two rounds, so no dollar estimate is given for them; the Gemini Nano round below reads them from each response.

## Gemini Nano: Private, Hybrid and Cloud (2026-11-26)

| | |
| --- | --- |
| Browser | Google Chrome 158.0.8127.88, a profile on D: (Chrome needs about 22 GB free on the profile's drive), no flags. Gemini Nano `nano_v3_gpu_low_tier_model` (component 2025.8.8.1141, 4,088 MiB) on the GTX 1050's 4 GB |
| App | Live site, bundle `index-Cvkl-krS.js` (JavaScript identical to `a1bb738`), Firebase JS SDK 13.4.0 |
| Method | `scripts/benchmark/cdp/run.mjs`: the same `runner.js`, driven over the Chrome DevTools Protocol, which also records the network outside the page (no headers, tokens or image bytes kept). One run per clip and mode, English descriptions |
| Results | `scripts/benchmark/results/nano-a1bb738/` (18 runs; one Hybrid run that hung is kept under `hang/`) |

| Clip | Private: time, coverage | Hybrid: time, cloud requests, KB to the AI, coverage | Cloud: time, requests, frames sent, KB, coverage |
| --- | --- | --- | --- |
| 01 Presentation | 134.4 s, 8/8 | 160.4 s\*, 1, 6.9, 5/8 | 24.6 s, 6, 5, 237.8, 4/8 |
| 02 Software tutorial | 148.2 s\*, 5/5 | 94.8 s, 1, 6.6, 2/5 | 27.3 s, 5, 4, 254.4, 3/5 |
| 03 Conversation | 24.6 s, 5/7 | 19.4 s, 1, 2.7, 7/7 | 32.0 s, 7, 3, 37.7, 6/7 |
| 04 Motion | 14.0 s, 3/6 | 16.5 s, 1, 2.7, 3/6 | 24.7 s, 5, 3, 26.2, 3/6 |
| 05 Continuous narration | 52.1 s, 4/5 | 36.0 s, 1, 3.2, 4/5 | 17.3 s, 5, 4, 75.9, 5/5 |
| 06 Fictional record | 71.8 s\*, 4/4 | 17.2 s, 1, 2.4, 4/4 | 6.7 s, 3, 1, 36.1, 1/4 |
| **All six** | **444.9 s, 0 requests, 0 frames, 29/35** | **344.2 s, 6 requests, 0 frames, 24.4 KB, 25/35** | **132.5 s, 31 requests, 20 frames, 668.1 KB, 22/35** |

\* includes loading the model after a page load: the first frame took 64.6 s (Hybrid 01), 79.3 s (Private 02) and 66.9 s (Private 06).

In every run, all three modes:

- kept every line within its pause;
- produced no number that is not on screen (clips 03, 04 and 06);
- had no overlap with the measured speech (clip 03);
- needed no retry (no 429 in this round).

The ledger's counts match the network capture in all 18 runs (`node scripts/benchmark/cdp/stats.mjs scripts/benchmark/results/nano-a1bb738`).

**Latency per inference** (from the ledger):

| | Range | Median | n |
| --- | --- | --- | --- |
| Gemini Nano, a frame, model loaded | 3.3–26.3 s | 8.8 s | 37 |
| Gemini Nano, a frame, model loading | 64.6–79.3 s | 66.9 s | 3 |
| Gemini Nano, fitting a line | 1.1–5.4 s | 2.1 s | 27 |
| Cloud, a frame | 0.9–4.8 s | 2.2 s | 20 |
| Cloud, the script | 1.2–19.4 s | 3.8 s | 12 |

Simple synthetic frames take 3 to 8 s on Nano; screenshots full of text take 16 to 26 s.

**Tokens and estimated cost** (from `usageMetadata` of each cloud response; `gemini-3.5-flash-lite` paid-tier price, USD 0.30 per million input and 2.50 per million output tokens, read 2026-11-26):

| | Input tokens | Output tokens | Estimated cost |
| --- | --- | --- | --- |
| Cloud | 33,023 | 2,442 | USD 0.0160, 0.0027 per video |
| Hybrid | 6,023 | 813 | USD 0.0038, 0.0006 per video |
| Private | 0 | 0 | 0 |

The runs used the free tier, so nothing was billed.

**What the round shows:**

- **Hybrid keeps the pixels on the device for the cost of one text request.** It sent 27 times fewer bytes than Cloud (24.4 KB against 668.1 KB), no frame, at about a quarter of the token cost. On this 4 GB GPU it was 2.6 times slower than Cloud.
- **Private sends nothing** and covered the most facts here (29/35). That is partly because Nano copies on-screen text into its lines, and the coverage regexes reward mentions, not fluency. Its lines are rougher:
  - clip 02 has a line cut off by trimming ("A dark green screen shows");
  - clip 02 also has a repeated line, flagged **Needs review**.
- **Cloud writes the most fluent lines but summarises.** Clip 06 left out the date of birth and the account number, and the last line of clip 01 came back empty. Clip 06's cloud coverage was 4/4 in the earlier round and 1/4 here: one run per clip is not enough to rank the modes.
- **Very short pauses still give thin lines in every mode**, for example "Budget over budget." in Hybrid clip 02.

## Tested since, and what is still not tested

Private and Hybrid with Gemini Nano, Hybrid without it (consent declined and given), offline and Gemma 4 were all run on 2026-11-26. The results are in the round above and in [GEMINI_NANO_VALIDATION.md](GEMINI_NANO_VALIDATION.md).

| Still not tested | Why | How to run it |
| --- | --- | --- |
| Other machines (CPU-only, other GPUs, macOS, Linux, ChromeOS) | one test machine | Start Chrome with `--user-data-dir` on a drive with 22 GB free and `--remote-debugging-port=9333`, press **Download Gemini Nano**, then `node scripts/benchmark/cdp/run.mjs <mode> <clip> <yes/no> runs --play` |
| Several runs per clip | time; the models are not deterministic | Repeat the runs above and compare the `summary.json` files |
| Descriptions in Spanish on all clips | one Spanish run (clip 03, Private) | `DESC_LANG=es node scripts/benchmark/cdp/run.mjs ...`; the references are written in English, so score Spanish runs by hand |
