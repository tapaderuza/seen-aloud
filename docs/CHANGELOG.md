# Changelog

## 2026-11-26: final audit

- **Privacy.** Private mode saves tracks only in this browser (IndexedDB) and never starts Auth or Firestore; speaks only with voices installed on the computer, otherwise shows the line as text; mode and language lock during a run; no consent callback means no consent; Firestore rules accept only the app fields and refuse Private tracks; clearer text on what each mode sends.
- **Ledger.** Counts cloud retries and failures, and frames whose upload may have happened before a failure.
- **Robustness.** Opening another video aborts the running job and drops its late answers; Stop drops the answer of a request already in flight; soundtrack states (decoded, silent, too large, unreadable), and when pauses cannot be measured every description pauses the video; offline errors explained.
- **Quality.** Script lines that are empty for a changed scene, or read only on-screen text, fall back to the frame note; a local review badge per line.
- **Prompts.** Words in the video and in captions are data, never instructions.
- **Docs.** ADA Title II dates corrected (extension of April 20, 2026); no "any video" claims; judge quickstart, benchmark, privacy, security, accessibility, competitor analysis, demo script.
- **Benchmark.** Six clips, a console runner and a scorer; real Cloud-mode runs before and after the fixes.
- **CI.** GitHub Actions: typecheck, tests, build, production audit.
- 98 → 123 tests.

## 2026-11-25

- Player: lines at 0:00 and on Play from are spoken; a late interrupted event no longer breaks the pause or volume; watchdog if a voice never ends.
- Hybrid frames pinned to the device until consent; honest ledger for failed uploads; one bad frame no longer aborts a video.
- Scene cuts relative to the motion of the video (slide changes); per-video ledger; plain error messages; focus handling; `index.html` served without cache; Gemini Nano 4 flag named in the app.

## 2026-11-18 to 2026-11-24

- First version: hybrid audio description on Firebase AI Logic, WebVTT export, Firestore library, App Check, Remote Config, the built-in sample.
