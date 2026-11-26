# Rules compliance (re-read 2026-11-26 at firebasehybridaihackathon.devpost.com/rules)

| Requirement (rules) | Status | Evidence |
| --- | --- | --- |
| Eligible entrant (age of majority; not resident of Brazil, Quebec, Crimea, Russia, Italy, Syria, Sudan, Belarus, Cuba, Iran, North Korea…) | Met | Owner resident in Spain |
| Web (Chrome): "Integrating with Gemini Nano 4 via Firebase AI Logic; the build must support Web applications or Chrome extensions" | Met | Web app on Firebase AI Logic hybrid inference (`src/ai/firebaseProvider.ts`). **Gemini Nano 4** ("Gemma 4 for Built-in AI", model `gemma4_gpu_low_tier_model`, component 2026.11.3.1140) validated in 5 recorded runs (`scripts/benchmark/results/gemma4-223c141/`, `offline-223c141/`) and in the demo video; Chrome's own page shows the model installed and `prompt_api_gemma4` Available (`05-gemini-nano-4-installed.png`). The 18-run benchmark used Chrome's default model (`nano_v3`) and is labelled so everywhere. The app tells users how to turn on Gemini Nano 4 |
| Firebase AI Logic hybrid inference | Met | `PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`, `initializeDeviceModel`, `inferenceSource` (docs/GEMINI_NANO_VALIDATION.md section 3) |
| Must run as shown in the video and text | Met | Live site; the new video is real captures of the live site |
| Video: shows the project working, no longer than 3 minutes, public on YouTube | Met | New video 2:17 with English narration and real app audio (`seen-aloud-demo-FINAL.mp4`). Published as Public: https://youtu.be/g2szbkyeOKI |
| English: the app supports English; materials in English or translated | Met | App, repository, Devpost text and video text in English |
| Open source allowed, with its licences respected | Met | Apache 2.0 (`LICENSE`); Firebase JS SDK, Apache 2.0 |
| No production API keys, project secrets or PII in the repository, form or testing instructions | Met | Firebase web config is public by design and protected by App Check; `.env.local` is not committed; the result files store no headers or tokens (scanned for API keys, JWTs, auth headers and the owner's name: none); the only personal-looking data is the invented record in clip 06 |
| Access for judges: free, until judging ends | Met | Public site and repository; no login; works without Gemini Nano (Cloud path, or Hybrid with consent) |
| Judges may judge from the text, images and video alone | Covered | The Devpost text, gallery and video carry the evidence |
| Built during the contest period | Met | Repository created 2026-11-18 |
| Prizes: one overall plus one "Best of"; Best Web/Chrome USD 3,000 | Category: Best Web/Chrome | Select Web (Chrome) in the form |
| No changes after the deadline (2026-11-30 14:00 PT, 23:00 in Spain) | To respect | Freeze the repository and the site after the final commit; do not edit Devpost after the deadline |
