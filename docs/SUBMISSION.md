# Devpost submission text (English, paste into the form)

**Project name:** Seen Aloud

**Tagline:** Audio description for any video, written on your own PC

**Platform:** Web (Chrome)

## Inspiration

Millions of blind and low-vision people can't follow most everyday video: lectures, tutorials, local news, family clips. Audio description exists, but it is a paid, manual service, and cloud tools ask you to upload your whole video, which is a non-starter for a school, a clinic or a family. Gemini Nano in Chrome made a different design possible: the pictures can stay on the computer.

## What it does

Seen Aloud turns any video file into an audio description track. It finds scene changes and the pauses in the dialogue locally, describes one key frame per scene with Gemini Nano, then writes a coherent finished script that fits the pauses. The built-in player speaks the descriptions, lowers the soundtrack, and pauses the video when a description is longer than the pause (extended audio description). You can edit every line and export a WebVTT description track or a plain script.

## How we use Firebase AI Logic

All inference goes through Firebase AI Logic hybrid inference, with a different mode per task:

- Frame descriptions (image + text): `PREFER_ON_DEVICE`. Many small calls, the frames are the private part of the video, and Nano is free.
- The final script (text only): `PREFER_IN_CLOUD`. It needs every scene at once; only text leaves the computer.
- Shortening a line to fit a pause: `PREFER_ON_DEVICE`.
- A Private mode (`ONLY_ON_DEVICE`) that guarantees nothing leaves the computer, and a Cloud mode (`ONLY_IN_CLOUD`) for machines without Nano.

The same JSON Schema constrains the on-device answer (`responseConstraint`) and the cloud answer (`responseJsonSchema`). A visible ledger, driven by `inferenceSource`, shows how many requests ran on the device vs. in the cloud and how many frames left the computer. The app enforces its privacy promise itself: when Chrome has no on-device model, Private mode refuses to run, and Hybrid mode asks before any frame is sent to the cloud; if Nano fails mid-request, the retry in the cloud follows the same consent rule.

Other Firebase products: App Check (reCAPTCHA Enterprise; debug provider locally), Remote Config (cloud model, scene sensitivity, speech pace, house style, validated and clamped), Anonymous Authentication and Firestore (saved tracks, text and timings only, with security rules).

## How we built it

TypeScript + Vite, the Firebase JS SDK, and the Chrome Prompt API through Firebase AI Logic. Scene and pause detection are plain algorithms over the video's pixels and audio, so the AI is only used where it adds value; a change counts as a cut when it stands out from the video's own motion, so the slide changes of a recorded lecture are found too. 98 unit tests cover scene and pause detection, word budgets, WebVTT/SRT, the model-output parsers, the hybrid routing (including the privacy guard, consent and fallback paths) and the description player. Built with Claude Code as the coding assistant.

## Challenges

Small on-device models wrap JSON in prose, don't count words, and forget who "she" is. We constrain output with a schema, budget words from the real pause length, and carry context from scene to scene. The SDK only falls back to the cloud if Nano is unavailable *before* the call, so we handle mid-request failures ourselves.

## What we learned

Hybrid inference is most useful when each feature picks its own mode: "prefer on device" for the many small private calls and "prefer cloud" for the one big text-only call.

## What's next

Voice selection, batch processing, recurring-character recognition, and a Chrome extension that adds the track to videos on the web.

## Built with

TypeScript, Vite, Firebase AI Logic (hybrid inference), Gemini Nano (Chrome Prompt API), Firebase App Check, Remote Config, Authentication, Firestore, Web Speech API, Vitest

## What was built during the contest period

Everything. The repository was created for #BuildHybridAI 2026 and contains no earlier application code. Third-party code: Firebase JS SDK (Apache 2.0).

## Testing instructions

Open https://seen-aloud.web.app in desktop Chrome 139+ (source: https://github.com/tapaderuza/seen-aloud). Press "Choose video" and pick any short MP4 (`npm run sample` makes one). Press "Describe this video". If Gemini Nano is not installed, the app asks before using the cloud for frames; choose "Use the cloud for this video". No login needed (anonymous sign-in is automatic).

---

# Demo video script (target 2:40, English, screen recording of desktop Chrome)

Show the hybrid working in the first 30 seconds.

| Time | On screen | Voice-over |
| --- | --- | --- |
| 0:00 | A 6 s clip playing with no description | "Most video has no audio description. If you're blind, this is just sound." |
| 0:10 | Seen Aloud, header "Gemini Nano: ready on this device", Hybrid selected | "Seen Aloud writes one, and the pictures never leave your computer. It runs Gemini Nano in Chrome through Firebase AI Logic hybrid inference." |
| 0:20 | Choose video, add captions, press Describe; steps light up | "It finds scene changes and pauses in the dialogue locally. Then Gemini Nano describes one frame per scene." |
| 0:40 | Scene cards fill with thumbnails and "On device" badges; ledger: 0 frames left the computer | "Every frame is described on the device. The ledger counts what left the computer: zero frames." |
| 1:00 | Script step; badges flip to "Cloud"; open the request log | "For the finished script, only text goes to Gemini in the cloud, which sees every scene at once. Prefer-cloud for this task, prefer-on-device for frames." |
| 1:20 | Press play; description is spoken; video pauses for a long one | "The player speaks each line, lowers the soundtrack, and pauses the video when a description is longer than the pause." |
| 1:45 | Edit a line; counter turns red; press "Fit to pause" | "Every line is editable. Fit to pause asks Nano to shorten it to the real pause length." |
| 2:00 | Cloud mode, describe again; then Private mode without Nano: refusal | "No Nano? Cloud mode works. Private mode refuses to run rather than quietly using the cloud." |
| 2:20 | Export WebVTT, Saved tracks, Firebase console 5 s | "Export a WebVTT track. App Check protects the API, Remote Config tunes the model, Firestore keeps text only." |
| 2:35 | Repo URL | "Seen Aloud: open source, Apache 2.0." |
