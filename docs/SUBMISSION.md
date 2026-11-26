# Devpost submission text (English, for the owner to paste)

**Project name:** Seen Aloud

**Tagline:** Audio description drafts for your videos, with the frames described on your own computer

**Platform:** Web (Chrome)

## Inspiration

A lecturer points at a chart and says "as you can see". A listener who cannot see the screen loses the numbers that carry the explanation. Audio description fixes that, but it is paid, manual work, and cloud tools ask you to upload the whole video, which a school, a clinic or a family often cannot do. For public bodies it is also a duty: WCAG 1.2.5 asks for audio description of prerecorded video, the EU applies it through EN 301 549, and the US ADA Title II rule applies it to state and local governments from April 26, 2027 (April 26, 2028 for smaller ones). Gemini Nano in Chrome made a different design possible: describe the pictures where they already are.

## What it does

Seen Aloud turns a video your browser can play into a timed, editable audio description track. It finds scene changes and pauses in the dialogue on the computer, describes one key frame per scene with Gemini Nano, and asks Gemini in the cloud, from text only, to write one coherent track that fits the pauses. The player speaks each line, lowers the soundtrack and pauses the video when a line needs more time (extended audio description). Every line is editable, carries a local review badge, and the track exports as WebVTT or a plain script.

Three modes, chosen in the header: **Hybrid** (frames on the device, script in the cloud), **Private** (every step on Gemini Nano; saved tracks and voices stay on the computer) and **Cloud** (for machines without Gemini Nano). A ledger shows where every request ran.

## How we built it

TypeScript and Vite on Firebase: AI Logic, App Check (reCAPTCHA Enterprise), Remote Config, Anonymous Authentication, Firestore and Hosting. Each task has its own `getGenerativeModel` instance and inference mode:

- Frame descriptions (image + text): `ONLY_ON_DEVICE` until the person agrees to the cloud, then `PREFER_ON_DEVICE`. This follows the image-captioning pattern in the Firebase hybrid guide and keeps the sensitive part, the pictures, on the device.
- The whole-track script (text only): `PREFER_IN_CLOUD`. It needs every scene at once, and the SDK falls back to Gemini Nano if the cloud cannot be reached.
- Fitting a line to its pause: `PREFER_ON_DEVICE`. Private mode: `ONLY_ON_DEVICE` everywhere. Cloud mode: `ONLY_IN_CLOUD`.

The same JSON Schema constrains the on-device answer (`responseConstraint`) and the cloud answer (`responseJsonSchema`). The ledger reads `response.inferenceSource`, counts retries (one inference can be up to three requests) and counts frames whose upload failed as having left. Scene cuts and pauses are plain signal processing, no AI. 132 automated tests cover the hybrid routing, the privacy guard, consent, timeouts, the player, pause states, cancellation and exports. Built with Claude Code as a coding assistant.

We checked it with a real model, on the live site:

- **Setup:** Google Chrome 158 with Gemini Nano on a 4 GB GTX 1050.
- **Private mode:** 0 requests to the AI endpoint.
- **Hybrid:** every frame was described on the device, and one text-only request per video went to the cloud.
- **Ledger:** in all 30 recorded runs, it matched a network capture taken outside the page with the Chrome DevTools Protocol.

## Challenges

The SDK falls back to the cloud silently when Chrome has no on-device model, even in `ONLY_ON_DEVICE`, and re-checks availability on every call, so a frame could reach the cloud without consent if Gemini Nano went away mid-video. We enforce the privacy rules in the app and pin frames to the device until the person agrees. Small models wrap JSON in prose and skip scenes, so the parser and the track writer fall back to the frame note when the picture would be lost. A benchmark on our own clips showed both problems; it also shows what we have not solved: one key frame per scene cannot describe motion.

Running on a real Gemini Nano found two more problems that no mock showed:

- **A frame request that never answered.** One on-device frame request never settled, and the job waited for 30 minutes. Requests to Nano now stop after 3 minutes: Hybrid asks before using the cloud for that frame, and Private leaves the line empty.
- **A download that never started.** With too little disk on the drive of the Chrome profile, Chrome says the model is "downloading" but never downloads it. The app now says so after 30 seconds and explains the 22 GB requirement.

## Accomplishments

- **A privacy promise that is enforced in code, visible in a ledger and checked against the network on the live site.**
  - **Fictional medical record, Private mode:** nothing left the computer.
  - **Hybrid:** no pixels left the computer; only text did, including the name Gemini Nano read off the screen. We say so in the app.
- **All three modes on six clips, one run each, with Gemini Nano.**
  - Hybrid sent no frame and 27 times fewer bytes than Cloud (24 KB against 668 KB), at about a quarter of the token cost.
  - Private sent nothing.
  - No line ran over its pause, no number was invented on the synthetic clips, and no line overlapped the measured speech.
- **Better Cloud coverage after the fixes:** annotated visual facts went from 20/29 to 26/29.
- axe-core reports no violations on the start screen, after a track is generated, with the consent dialog open, in dark mode and at 375 px.

## What we learned

Hybrid inference works best when each feature picks its own mode, and when the app, not only the SDK, decides what is allowed to leave the device.

## What's next

Several frames for scenes with motion, masking of personal data in the text sent to the cloud, an offline mode, a Chrome extension for videos on the web, and sessions with blind and low-vision viewers.

## Built during the contest period

Everything; the repository was created for #BuildHybridAI 2026. Third-party code: the Firebase JS SDK (Apache 2.0). Not affiliated with seenaloud.com, an unrelated commercial service.

## Testing instructions

Open https://seen-aloud.web.app in desktop Google Chrome 148+. Press **Try built-in sample video (45s)**, then **Describe this video**. Without Gemini Nano, the app asks before using the cloud for frames: choose **Use the cloud for this video**. Press play, then check **Where the AI ran** and export **WebVTT**.

To see frames described on your computer, press **Download Gemini Nano** in the header. No flags are needed, but Chrome needs about 22 GB free on the drive that holds your Chrome profile.

- Five-minute guide: https://github.com/tapaderuza/seen-aloud/blob/main/docs/JUDGE_QUICKSTART.md
- Real Gemini Nano runs, network capture and screenshots: https://github.com/tapaderuza/seen-aloud/blob/main/docs/GEMINI_NANO_VALIDATION.md
