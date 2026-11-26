# Devpost: final text, field by field

Paste each block into the matching field of the existing project (https://devpost.com/software/seen-aloud → Edit). Do not create a new project. Every number links back to a recorded result; see the end of this file.

## Project name
Seen Aloud

## Tagline
Editable audio description for your videos: Gemini Nano 4 describes the frames on your computer, and the cloud writes the track from text only.

## Video
https://www.youtube.com/watch?v=REPLACE_WITH_NEW_VIDEO_ID (upload `seen-aloud-demo-FINAL.mp4` from this folder; see VIDEO_SCRIPT_FINAL.md)

## Try it out (links)
- https://seen-aloud.web.app
- https://github.com/tapaderuza/seen-aloud

## Category
Best Web/Chrome (Web: Gemini Nano 4 via Firebase AI Logic)

## Built with
typescript, vite, firebase, firebase-ai-logic, gemini-nano, gemini-api, chrome-prompt-api, app-check, recaptcha-enterprise, firestore, firebase-authentication, remote-config, firebase-hosting, web-speech-api, webvtt, indexeddb

---

## Inspiration

A lecturer points at a chart and says "as you can see". A listener who cannot see the screen loses the numbers. Audio description fixes that, but it is paid, manual work, and cloud tools ask you to upload the whole video, which a school, a clinic or a family often cannot do. For public bodies it is also a duty: WCAG 1.2.5 asks for audio description of prerecorded video. The EU applies it through EN 301 549, and the US ADA Title II rule applies it to state and local governments from April 26, 2027 (April 26, 2028 for smaller ones). Gemini Nano in Chrome made a different design possible: describe the pictures where they already are.

## What it does

**Seen Aloud makes video more accessible while keeping sensitive visual data on the user's device, through Firebase AI Logic hybrid inference.**

It turns a video your browser can play into a timed, editable audio description track:

1. It finds scene changes, and pauses in the dialogue, on the computer.
2. It describes one key frame per scene with Gemini Nano.
3. It asks Gemini in the cloud, from text only, to write one coherent track that fits the pauses.
4. The player speaks each line, lowers the soundtrack, and pauses the video when a line needs more time (extended audio description).
5. Every line is editable and carries a local review badge. The track exports as WebVTT or a plain script.

Three modes:

- **Hybrid:** frames on the device, script in the cloud.
- **Private:** every step on Gemini Nano.
- **Cloud:** for machines without Nano.

A ledger shows where every request ran. Without Gemini Nano, Hybrid asks before any frame leaves the computer.

## How we built it

TypeScript and Vite on Firebase: AI Logic, App Check (reCAPTCHA Enterprise), Remote Config, Anonymous Authentication, Firestore and Hosting. Each task has its own `getGenerativeModel` instance and inference mode:

- **Frame descriptions (image + text):** `ONLY_ON_DEVICE` until the person agrees to the cloud, then `PREFER_ON_DEVICE`. The pictures, the sensitive part, stay on the device.
- **The whole-track script (text only):** `PREFER_IN_CLOUD`. When the network is down, the SDK falls back to Gemini Nano. We saw it happen in an offline run.
- **Fitting a line to its pause:** `PREFER_ON_DEVICE`.
- **Private mode:** `ONLY_ON_DEVICE` everywhere. **Cloud mode:** `ONLY_IN_CLOUD`.

The same JSON Schema constrains the on-device answer (`responseConstraint`) and the cloud answer (`responseJsonSchema`). The ledger reads `response.inferenceSource`. Scene cuts and pauses are plain signal processing, no AI. 132 automated tests pass. Built with Claude Code as a coding assistant.

**How we checked it.** We drove the live site in Google Chrome 158 over the Chrome DevTools Protocol, which records every network request outside the page. There are 30 recorded runs:

- **Gemini Nano 4** ("Gemma 4 for Built-in AI") in 5 of them, including 2 offline.
- **Chrome's default Gemini Nano** in an 18-run benchmark of all three modes on six clips.

In every run, the app's ledger matched the captured traffic.

## Challenges

The SDK quietly uses the cloud when Chrome has no on-device model, even in `ONLY_ON_DEVICE`. It also re-checks availability on every call, so a frame could reach the cloud without consent if Nano went away mid-video. The app enforces the privacy rules itself, and pins frames to the device until the person agrees.

Running on a real Gemini Nano found two problems no mock showed:

- **An on-device request that never answered.** Requests to Nano now stop after 3 minutes.
- **A download Chrome never starts when the disk is short of the 22 GB it needs.** The app now says so after 30 seconds, instead of waiting in silence.

## Accomplishments

Measured, one run per clip and mode, on one machine (4 GB GTX 1050):

- **Hybrid with Gemini Nano sent 0 frames.** It made one text-only cloud request per video.
- **Hybrid sent 96.4% less data to the inference service than Cloud** (24,945 against 684,150 bytes over six clips), at an estimated 76.0% lower inference cost (paid-tier prices; the runs used the free tier).
- **Private made no request to the cloud inference service**, including on a fictional medical record.
- **Offline:** with the page and the model already loaded, Private and Hybrid finished a video with the network disconnected.
- **Quality:** no line ran over its pause, and no number was invented on the synthetic clips. On the clip where speech was measured independently, no line overlapped it.
- **Accessibility:** axe-core reported no violations in the five interface states we checked.

## What we learned

Hybrid inference works best when each feature picks its own mode, and when the app, not only the SDK, decides what may leave the device. A ledger that people can check against the network is worth more than a privacy claim.

## What's next

- Several frames for scenes with motion.
- Masking of personal data in the text Hybrid sends to the cloud.
- An offline-installable page.
- A Chrome extension for videos on the web.
- Sessions with blind and low-vision viewers.

## Limits we state plainly

- **Hybrid sends text, not pixels.** Text Gemini Nano reads off the screen (a name, a date of birth) goes to the cloud as part of the script request. Use Private for sensitive footage.
- **Hybrid is slower.** On the tested hardware it was 2.6 times slower than Cloud.
- **One key frame per scene**, so motion inside a scene is not described.
- **A small benchmark:** one machine and one run per clip and mode. Coverage is scored with regular expressions.
- **Speech overlap** was measured independently only on the conversation clip.
- **No sessions with blind users yet.** The app drafts a track for a person to review. It does not guarantee WCAG compliance or absolute privacy.

## Built during the contest period

Everything; the repository was created for #BuildHybridAI 2026. Third-party code: the Firebase JS SDK (Apache 2.0). Open source under Apache 2.0. Not affiliated with seenaloud.com, an unrelated commercial service.

## Testing instructions

1. Open https://seen-aloud.web.app in desktop Google Chrome 148 or later.
2. Press **Try built-in sample video (45s)**, then **Describe this video**. Without Gemini Nano, the app asks before using the cloud for frames: choose **Use the cloud for this video**.
3. Press play, then check **Where the AI ran** and export **WebVTT**.

**To run on Gemini Nano 4:**

1. Turn on **Gemma 4 for Built-in AI** in `chrome://flags` and restart Chrome.
2. Press **Download Gemini Nano** in the header. Chrome needs about 22 GB free on the drive that holds the Chrome profile.

More:

- Five-minute guide: https://github.com/tapaderuza/seen-aloud/blob/main/docs/JUDGE_QUICKSTART.md
- Real Gemini Nano runs, network capture and screenshots: https://github.com/tapaderuza/seen-aloud/blob/main/docs/GEMINI_NANO_VALIDATION.md

---

## Gallery images (upload in this order, from this folder)

| # | File | Caption |
| --- | --- | --- |
| 1 | `01-hero.png` | Real run on the live site, Hybrid with Gemini Nano 4: 5 frames on the device, 1 text-only cloud request, 0 frames sent. |
| 2 | `02-hybrid-ledger-gemini-nano-4.jpg` | Where the AI ran: requests on the device, in the cloud, and frames that left the computer. |
| 3 | `03-private-fictional-record-gemini-nano-4.jpg` | Private mode on a fictional medical record: every step on Gemini Nano 4, no request to the AI service. |
| 4 | `04-evidence-three-modes.png` | Six clips, three modes, network captured outside the page. |
| 5 | `05-gemini-nano-4-installed.png` | chrome://on-device-internals on the test machine: the Gemma 4 model (Gemini Nano 4) installed and in use. |
| 6 | `../nano/05-private-spanish-local-voice.png` | Private mode in Spanish, read aloud by a voice installed on the computer. |

## Where each number comes from

| Claim | Source |
| --- | --- |
| 132 tests | `npm test`; CI on GitHub Actions |
| 30 recorded runs | `scripts/benchmark/results/`: `nano-a1bb738` (18), `nano-223c141` (4), `no-nano-223c141` (3), `gemma4-223c141` (3), `offline-223c141` (2) |
| Ledger matches the capture | `node scripts/benchmark/cdp/stats.mjs <folder>` on each folder |
| 0 frames in Hybrid, 1 text request per video | `nano-a1bb738/hybrid-*.json`, `gemma4-223c141/hybrid-*.json` (`cdpNetwork`) |
| 96.4% less data | 24,945 bytes (Hybrid) against 684,150 bytes (Cloud), delivered AI requests in `nano-a1bb738` |
| 76.0% lower estimated cost | Tokens from `usageMetadata`: Hybrid 6,023 in / 813 out = USD 0.003839; Cloud 33,023 in / 2,442 out = USD 0.016012 (gemini-3.5-flash-lite paid tier: 0.30 and 2.50 USD per million) |
| 2.6 times slower | 344.2 s against 132.5 s over the six clips |
| Offline | `offline-223c141/` |
| Gemini Nano 4 | `gemma4-223c141/`, `offline-223c141/`, `05-gemini-nano-4-installed.png`, docs/GEMINI_NANO_VALIDATION.md section 8 |
| axe-core, five states | docs/ACCESSIBILITY.md |
