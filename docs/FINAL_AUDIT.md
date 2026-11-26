# Final audit (2026-11-26)

Baseline before changes: commit `3a1bc04`, 98 tests passing, typecheck and build clean, deployed bundle identical to the build.

## Confirmed and fixed

| Finding | Fix | Commit |
| --- | --- | --- |
| ADA Title II dates out of date ("from April 2026") | DOJ extension of April 20, 2026 (ada.gov fact sheet): April 26, 2027 for 50,000 people or more, April 26, 2028 for smaller entities; no claim that a draft track makes a video compliant | `fd03592` |
| "Any video" claims | Replaced everywhere | `fd03592` |
| Private mode saved tracks (descriptions, file name) to Firestore | Private mode saves only to IndexedDB; Firestore rules refuse Private tracks | `64a16b9`, `70e9270` |
| Private mode could read descriptions with a network voice | Only `localService` voices; otherwise text with `aria-live` and an explanation | `64a16b9` |
| Auth and Firestore started in every mode | Created on first use; Private mode never uses them (verified on the live site) | `64a16b9` |
| A missing consent callback meant consent | It now means no consent | `64a16b9` |
| Hybrid text sent to the cloud not disclosed | Mode help and dialog say scene notes, on-screen text and caption text go as text | `64a16b9` |
| Retries and failures invisible in the ledger | Counted and logged; one inference can be three requests | `64a16b9` |
| Mode could change in the middle of a run | Mode and language locked while a job runs | `64a16b9` |
| A new video during a run could receive the old answers | Opening a video aborts the run and drops late answers | `64a16b9` |
| An answer that arrived after Stop was used | Dropped | `64a16b9` |
| Unreadable or too-large soundtrack treated as all pause (descriptions could cover dialogue) | Distinct states; when pauses are unknown every description pauses the video, and the app says why | `64a16b9` |
| Words in the video could steer the model | Every prompt treats them as data | `64a16b9` |
| Firestore rules checked only title and line count | Allowed keys, types, sizes, server timestamp, mode | `70e9270` |
| Script lines empty for changed scenes, or only "On screen: ..." (found by the benchmark) | Fall back to the frame note | `ffc260a` |
| No quality signal per line | Local review badge (Checks passed / Needs review with the reason) | `ffc260a` |
| No CI | GitHub Actions: typecheck, tests, build, audit | `ffc260a` |
| Reduced motion not honoured | `prefers-reduced-motion` rule | `ffc260a` |

Earlier the same week (`3cdf2e6` to `3a1bc04`): player at 0:00 and Play from, speech state machine, frames pinned to the device until consent, honest ledger for failed uploads, slide-change detection, flags for Gemini Nano 4.

## Checked and not a problem

- A silent cloud fallback in Private mode: the guard already existed (`PrivacyGuardError` before any request); now also covered by a test that every Private call is `ONLY_ON_DEVICE`.
- Secrets in the repository or history: none found. No App Check debug token in the production bundle.
- WebVTT export: valid header, NOTE block, timestamps, escaping, no empty cues.
- `npm audit` advisories: in the Node.js transport of Firestore, not in the browser bundle (see [SECURITY.md](SECURITY.md)).

## Found during this audit, not fixed

- **Name conflict (decided 2026-11-26: keep Seen Aloud).** seenaloud.com is a paid AI audio-description service (Hong Kong; terms effective 2026-10-24; online by 2026-10-14, before this repository was created), same name, same market, English and Spanish, WebVTT exports. No trademark symbol on its pages. Judges who search the name will find it. Decision: the name stays Seen Aloud everywhere (app, repository, demo video, Devpost), so nothing carries two names during judging. The app footer, the README and the Devpost text say that this project is not affiliated with seenaloud.com. A new name (proposal below) is left for after judging.
- **Motion within a scene is not described** (benchmark clip 04). Several frames per moving scene were not added: it could not be validated on Gemini Nano before the deadline.
- **No masking of names or numbers** in the text sent to the cloud in Hybrid mode.
- **No offline mode** (no service worker).
- **No Playwright end-to-end tests and no Firestore emulator tests**: Playwright browsers are not installed and the emulator needs Java. The checks were run by script against the live site instead.
- **Audio export** (a track with the spoken descriptions) is not offered: the Web Speech API does not give access to its audio. WebVTT and the script are the exports.

## Verification

- **Tests:** 123 passing (`npm test`), typecheck clean, production build clean (one chunk-size warning, 768 kB).
- **Privacy, live site:** Private mode at load contacted only App Check; no Auth or Firestore traffic. Private playback with only a network voice for the language spoke nothing and showed the text. Cloud runs: ledger, request log and network capture agree (see [BENCHMARK.md](BENCHMARK.md)). Real HTTP 429 answers were retried and logged.
- **Firestore:** hardened rules deployed; saving a track from the live site still works.
- **Accessibility:** axe-core 0 violations in five states ([ACCESSIBILITY.md](ACCESSIBILITY.md)).
- **Benchmark:** six clips, Cloud mode; coverage 20/29 to 26/29 on the five clips valid in both rounds.
- **Gemini Nano (added the same day, [GEMINI_NANO_VALIDATION.md](GEMINI_NANO_VALIDATION.md)):**
  - **Setup:** Private, Hybrid and Cloud ran on the live site in Google Chrome 158 with Gemini Nano on the GTX 1050.
  - **Network:** recorded outside the page over CDP; the ledger matched it in all 30 recorded runs.
  - **Why it was untested before:** the earlier audits ran in a browser without built-in AI. The owner's Chrome profile drive (C:) has 8 GB free, and Chrome needs 20 GB to install the model.
  - **Defects found and fixed in `223c141`:** one hung Nano request, and a download Chrome never starts.
  - **Tests:** 132 now.
- **NOT TESTED:** other browsers, other GPUs and CPU-only machines, macOS, Linux.

## Naming proposal (for after judging)

| Name | Checks (2026-11-26) |
| --- | --- |
| **HearFrame** (recommended) | No product or GitHub repository with this name found; `hearframe.app` has no DNS; `hearframe.com` is parked for sale. Short, says what it does: hear every frame. |
| FrameTold | `frametold.com` and `.app` have no DNS; close to "Frametell", an unrelated storytelling app |
| Keyframe Voice | `.com` and `.app` have no DNS; descriptive but long |
| FrameNarrator | `.com` and `.app` have no DNS; generic |
| Glance Aloud | `.com` and `.app` have no DNS; keeps "Aloud", so some confusion remains |

No formal trademark search was done; run one before any commercial use.

Migration that keeps everything working: rename the product in the UI, README and docs to "HearFrame (formerly Seen Aloud)"; keep the URL `seen-aloud.web.app`, the Firebase project and the IndexedDB name; optionally rename the GitHub repository (GitHub redirects the old URL). The demo video says "Seen Aloud", so the Devpost title should read "HearFrame (formerly Seen Aloud)". Not done: on 2026-11-26 the owner chose to keep Seen Aloud until judging ends, with the non-affiliation notice.

## Scores against the official criteria (our estimate, 1 to 5)

| Criterion | Before | After |
| --- | --- | --- |
| Technological implementation | 4.0 | 4.5 |
| Design | 4.0 | 4.3 |
| Potential impact | 4.5 | 4.5 |
| Quality of the idea | 4.0 | 4.3 |

## Verdict: CONDITIONAL GO

Conditions: paste the new Devpost text (the live page still has the old ADA date, and it carries the non-affiliation line), and if possible run the Gemini Nano checks on a computer that has it.

**Update, same day: GO.** The Gemini Nano checks were run: real hybrid inference is verified end to end on the live site. The only condition left is pasting the Devpost text, which the owner does by hand.
